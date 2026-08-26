import type { DatabaseSync } from 'node:sqlite'
import { openDatabase, toJson, fromJson, toBool, fromBool, now, allAs, getAs } from './open.js'
import { BUILDING_MIGRATIONS } from './schema/building.js'
import { buildingDbPath } from './paths.js'
import { newId } from './idgen.js'
import { redactSecrets } from './redact.js'
import {
  asApprovalId, asFloorId, asMemoryId, asMessageId, asTaskId,
  type ApprovalId, type BuildingId, type FloorId, type MemoryId, type MessageId, type TaskId,
} from '../domain/ids.js'
import type { Floor, FloorRole, Posting } from '../domain/building.js'
import type { Approval, ApprovalPayload, Message, MessageKind, Task, TaskLimits, TaskResult, TaskState } from '../domain/work.js'
import type { MemoryLayer, MemoryRecord, MemoryScope } from '../domain/memory.js'

export interface HireInput {
  role: FloorRole
  name: string
  charter: string
  posting: Posting
  tools?: readonly string[]
}

export interface AssignInput {
  by: FloorId
  to: FloorId
  goal: string
  acceptance?: readonly string[]
  limits?: Partial<TaskLimits>
}

export interface RememberInput {
  scope: MemoryScope
  layer: MemoryLayer
  text: string
  floor?: FloorId | null
  source?: string
  pinned?: boolean
  confidence?: number
  expiresAt?: string | null
}

const DEFAULT_LIMITS: TaskLimits = { tokens: 60_000, timeoutSeconds: 900, depth: 2 }

/**
 * Everything one building is. Opened per building, because a building shares
 * nothing with its neighbours and that is what makes it portable.
 */
export class BuildingStore {
  private constructor(
    private readonly db: DatabaseSync,
    readonly buildingId: BuildingId,
  ) {}

  static open(buildingId: BuildingId, path = buildingDbPath(buildingId)): BuildingStore {
    return new BuildingStore(openDatabase(path, BUILDING_MIGRATIONS), buildingId)
  }

  close(): void {
    this.db.close()
  }

  // ---- staff -------------------------------------------------------------

  /** Take on a member of staff. They get the next floor up. */
  hire(input: HireInput): Floor {
    const highest = getAs<{ level: number | null }>(
      this.db.prepare('select max(level) as level from floors'),
    )
    const floor: Floor = {
      id: asFloorId(newId('flr')),
      building: this.buildingId,
      level: (highest?.level ?? 0) + 1,
      role: input.role,
      name: input.name,
      charter: input.charter,
      posting: input.posting,
      tools: input.tools ?? [],
      hiredAt: now(),
      vacatedAt: null,
    }
    this.db
      .prepare(
        `insert into floors (id, level, role, name, charter, posting, tools, hired_at, vacated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, null)`,
      )
      .run(floor.id, floor.level, floor.role, floor.name, floor.charter, toJson(floor.posting), toJson(floor.tools), floor.hiredAt)
    return floor
  }

  /**
   * Staff, drawn in the order a building is read: the manager on top, then
   * everyone else by seniority. The manager rides up as the building grows.
   */
  staff(options: { includeVacated?: boolean } = {}): Floor[] {
    const sql = options.includeVacated
      ? 'select * from floors order by level'
      : 'select * from floors where vacated_at is null order by level'
    const floors = allAs<FloorRow>(this.db.prepare(sql)).map((r) => hydrateFloor(r, this.buildingId))
    const manager = floors.filter((f) => f.role === 'manager')
    const rest = floors.filter((f) => f.role !== 'manager').reverse()
    return [...manager, ...rest]
  }

  /**
   * How tall the building is.
   *
   * The curator works in the archives, below ground, so it does not add a
   * storey. A building should not appear to grow because it started tidying up.
   */
  headcount(): number {
    return getAs<{ n: number }>(
      this.db.prepare("select count(*) as n from floors where vacated_at is null and role != 'curator'"),
    )!.n
  }

  floor(id: FloorId): Floor | null {
    const row = getAs<FloorRow>(this.db.prepare('select * from floors where id = ?'), id)
    return row ? hydrateFloor(row, this.buildingId) : null
  }

  floorByRole(role: FloorRole): Floor | null {
    const row = getAs<FloorRow>(
      this.db.prepare('select * from floors where role = ? and vacated_at is null order by level limit 1'),
      role,
    )
    return row ? hydrateFloor(row, this.buildingId) : null
  }

  /** Move a floor to a different model, provider or engine. */
  repost(id: FloorId, posting: Posting): void {
    this.db.prepare('update floors set posting = ? where id = ?').run(toJson(posting), id)
  }

  /** Their memory is archived, never deleted, and their floor stays on record. */
  vacate(id: FloorId): void {
    this.db.prepare('update floors set vacated_at = ? where id = ?').run(now(), id)
  }

  // ---- work --------------------------------------------------------------

  assign(input: AssignInput): Task {
    const task: Task = {
      id: asTaskId(newId('tsk')),
      building: this.buildingId,
      assignedBy: input.by,
      assignedTo: input.to,
      goal: input.goal,
      acceptance: input.acceptance ?? [],
      limits: { ...DEFAULT_LIMITS, ...input.limits },
      state: 'queued',
      result: null,
      createdAt: now(),
      settledAt: null,
    }
    this.db
      .prepare(
        `insert into tasks (id, assigned_by, assigned_to, goal, acceptance, limits, state, result, created_at, settled_at)
         values (?, ?, ?, ?, ?, ?, ?, null, ?, null)`,
      )
      .run(task.id, task.assignedBy, task.assignedTo, task.goal, toJson(task.acceptance), toJson(task.limits), task.state, task.createdAt)
    return task
  }

  task(id: TaskId): Task | null {
    const row = getAs<TaskRow>(this.db.prepare('select * from tasks where id = ?'), id)
    return row ? hydrateTask(row, this.buildingId) : null
  }

  tasks(filter: { state?: TaskState; assignedTo?: FloorId } = {}): Task[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.state) { where.push('state = ?'); params.push(filter.state) }
    if (filter.assignedTo) { where.push('assigned_to = ?'); params.push(filter.assignedTo) }
    const sql = `select * from tasks ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at`
    return allAs<TaskRow>(this.db.prepare(sql), ...params).map((r) => hydrateTask(r, this.buildingId))
  }

  /** How many floors have work in hand — which is what lights their windows. */
  busyFloors(): number {
    return getAs<{ n: number }>(
      this.db.prepare("select count(distinct assigned_to) as n from tasks where state in ('queued','working','awaiting-review')"),
    )!.n
  }

  /** Tighten (or loosen) what a task may spend, after it has been assigned. */
  reLimit(id: TaskId, limits: TaskLimits): void {
    this.db.prepare('update tasks set limits = ? where id = ?').run(toJson(limits), id)
  }

  setTaskState(id: TaskId, state: TaskState): void {
    this.db.prepare('update tasks set state = ? where id = ?').run(state, id)
  }

  settle(id: TaskId, state: TaskState, result: TaskResult | null): void {
    this.db
      .prepare('update tasks set state = ?, result = ?, settled_at = ? where id = ?')
      .run(state, result ? toJson(result) : null, now(), id)
  }

  // ---- the post ----------------------------------------------------------

  post(input: { kind: MessageKind; from: FloorId; to: FloorId; body: string; inReplyTo?: MessageId | null }): Message {
    const message: Message = {
      id: asMessageId(newId('msg')),
      building: this.buildingId,
      kind: input.kind,
      from: input.from,
      to: input.to,
      inReplyTo: input.inReplyTo ?? null,
      body: input.body,
      readAt: null,
      createdAt: now(),
    }
    this.db
      .prepare(
        `insert into messages (id, kind, sender, recipient, in_reply_to, body, read_at, created_at)
         values (?, ?, ?, ?, ?, ?, null, ?)`,
      )
      .run(message.id, message.kind, message.from, message.to, message.inReplyTo, message.body, message.createdAt)
    return message
  }

  /** Unread post for one floor, oldest first. */
  inbox(floorId: FloorId): Message[] {
    return allAs<MessageRow>(
      this.db.prepare('select * from messages where recipient = ? and read_at is null order by created_at'),
      floorId,
    ).map((r) => hydrateMessage(r, this.buildingId))
  }

  markRead(id: MessageId): void {
    this.db.prepare('update messages set read_at = ? where id = ?').run(now(), id)
  }

  // ---- the approval desk -------------------------------------------------

  requestApproval(input: {
    kind: Approval['kind']
    by: FloorId
    intent: string
    payload?: ApprovalPayload
  }): Approval {
    const approval: Approval = {
      id: asApprovalId(newId('apr')),
      building: this.buildingId,
      kind: input.kind,
      requestedBy: input.by,
      intent: input.intent,
      payload: input.payload ?? null,
      state: 'pending',
      decidedAt: null,
      createdAt: now(),
    }
    this.db
      .prepare(
        `insert into approvals (id, kind, requested_by, intent, payload, state, decided_at, created_at)
         values (?, ?, ?, ?, ?, 'pending', null, ?)`,
      )
      .run(
        approval.id, approval.kind, approval.requestedBy, approval.intent,
        approval.payload ? toJson(approval.payload) : null, approval.createdAt,
      )
    return approval
  }

  approval(id: ApprovalId): Approval | null {
    const row = getAs<ApprovalRow>(this.db.prepare('select * from approvals where id = ?'), id)
    return row ? hydrateApproval(row, this.buildingId) : null
  }

  pendingApprovals(): Approval[] {
    return allAs<ApprovalRow>(
      this.db.prepare("select * from approvals where state = 'pending' order by created_at"),
    ).map((r) => hydrateApproval(r, this.buildingId))
  }

  decide(id: ApprovalId, granted: boolean): void {
    this.db
      .prepare('update approvals set state = ?, decided_at = ? where id = ?')
      .run(granted ? 'granted' : 'refused', now(), id)
  }

  // ---- spending ----------------------------------------------------------

  recordSpend(entry: {
    floor?: FloorId | null
    task?: TaskId | null
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
  }): void {
    this.db
      .prepare(
        `insert into spend (floor_id, task_id, provider, model, input_tokens, output_tokens, at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(entry.floor ?? null, entry.task ?? null, entry.provider, entry.model, entry.inputTokens, entry.outputTokens, now())
  }

  /** Output tokens spent since an ISO timestamp. Budgets are checked against this. */
  spentSince(iso: string): number {
    return getAs<{ n: number | null }>(
      this.db.prepare('select sum(output_tokens) as n from spend where at >= ?'),
      iso,
    )!.n ?? 0
  }

  /**
   * Output tokens spent since the first of this month.
   *
   * The unit a monthly allowance is actually judged in. Calendar month rather
   * than rolling thirty days, because "how much have I spent this month" is the
   * question people ask and a rolling window answers a different one.
   */
  spentThisMonth(now_: Date = new Date()): number {
    const first = new Date(now_.getFullYear(), now_.getMonth(), 1)
    return this.spentSince(first.toISOString())
  }

  spentOnTask(id: TaskId): number {
    return getAs<{ n: number | null }>(
      this.db.prepare('select sum(output_tokens) as n from spend where task_id = ?'),
      id,
    )!.n ?? 0
  }

  // ---- working the building ----------------------------------------------

  /**
   * Claim this building for a stretch of work, or find out who holds it.
   *
   * The daemon runs standing orders while nobody is watching, and the owner may
   * type a goal at the same moment. Two managers assigning at once produces
   * duplicate work and a baffling transcript.
   *
   * The claim expires rather than only being released, because a process that
   * is killed cannot tidy up, and a claim nobody can clear locks the building
   * for good.
   */
  claim(holder: string, seconds = 300, at: Date = new Date()): { ok: true } | { ok: false; heldBy: string } {
    const held = getAs<{ holder: string; expires_at: string }>(
      this.db.prepare('select holder, expires_at from claim where id = 1'),
    )
    if (held && held.expires_at > at.toISOString() && held.holder !== holder) {
      return { ok: false, heldBy: held.holder }
    }
    const expires = new Date(at.getTime() + seconds * 1000).toISOString()
    this.db
      .prepare(
        `insert into claim (id, holder, claimed_at, expires_at) values (1, ?, ?, ?)
         on conflict (id) do update set holder = excluded.holder, claimed_at = excluded.claimed_at, expires_at = excluded.expires_at`,
      )
      .run(holder, at.toISOString(), expires)
    return { ok: true }
  }

  /** Push the expiry out. Called while long work is still going on. */
  renewClaim(holder: string, seconds = 300, at: Date = new Date()): void {
    this.db
      .prepare('update claim set expires_at = ? where id = 1 and holder = ?')
      .run(new Date(at.getTime() + seconds * 1000).toISOString(), holder)
  }

  releaseClaim(holder: string): void {
    this.db.prepare('delete from claim where id = 1 and holder = ?').run(holder)
  }

  claimHolder(at: Date = new Date()): string | null {
    const held = getAs<{ holder: string; expires_at: string }>(
      this.db.prepare('select holder, expires_at from claim where id = 1'),
    )
    return held && held.expires_at > at.toISOString() ? held.holder : null
  }

  // ---- the archives ------------------------------------------------------

  /**
   * Write something to the archives.
   *
   * Every route into memory comes through here — an agent's `remember`, the
   * history the building writes for itself, the curator's consolidations — which
   * is why the redaction lives here rather than at each caller. A note is the
   * durable copy: a key that reaches one is there for good, is returned by every
   * future recall that matches it, and gets promoted into something more
   * permanent by the curator.
   */
  remember(input: RememberInput): MemoryRecord {
    // The marker left in its place is the record that it happened: it is visible
    // in the archives, it survives consolidation, and it needs no second table.
    input = { ...input, text: redactSecrets(input.text).text }

    const record: MemoryRecord = {
      id: asMemoryId(newId('mem')),
      scope: input.scope,
      layer: input.layer,
      floor: input.floor ?? null,
      building: this.buildingId,
      text: input.text,
      source: input.source ?? '',
      pinned: input.pinned ?? false,
      confidence: input.confidence ?? 0.5,
      useCount: 0,
      lastUsedAt: null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now(),
    }
    this.db
      .prepare(
        `insert into memory (id, scope, layer, floor_id, text, source, pinned, confidence, use_count, last_used_at, expires_at, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?, ?)`,
      )
      .run(record.id, record.scope, record.layer, record.floor, record.text, record.source, toBool(record.pinned), record.confidence, record.expiresAt, record.createdAt)
    return record
  }

  /** The always-on core: what an agent carries without having to ask for it. */
  pinned(floorId: FloorId | null): MemoryRecord[] {
    return allAs<MemoryRow>(
      this.db.prepare(
        `select * from memory
         where pinned = 1
           and (expires_at is null or expires_at > ?)
           and (scope = 'building' or scope = 'skyline' or floor_id = ?)
         order by created_at`,
      ),
      now(),
      floorId,
    ).map((r) => hydrateMemory(r, this.buildingId))
  }

  /**
   * Keyword recall. Meaning-based recall joins this at M1; the two are ranked
   * together rather than one replacing the other, because each finds what the
   * other misses.
   */
  recallByKeyword(query: string, options: { floor?: FloorId | null; limit?: number } = {}): MemoryRecord[] {
    const cleaned = query.replace(/["']/g, ' ').trim()
    if (cleaned.length === 0) return []
    const rows = allAs<MemoryRow>(
      this.db.prepare(
        `select memory.* from memory_fts
         join memory on memory.rowid = memory_fts.rowid
         where memory_fts match ?
           and (memory.expires_at is null or memory.expires_at > ?)
           and (memory.scope in ('building','skyline') or memory.floor_id = ?)
         order by bm25(memory_fts), memory.use_count desc
         limit ?`,
      ),
      cleaned.split(/\s+/).map((t) => `"${t}"`).join(' OR '),
      now(),
      options.floor ?? null,
      options.limit ?? 8,
    )
    return rows.map((r) => hydrateMemory(r, this.buildingId))
  }

  /** Recall is use: a fact that keeps proving useful should rank higher next time. */
  markRecalled(ids: readonly MemoryId[]): void {
    if (ids.length === 0) return
    const stmt = this.db.prepare('update memory set use_count = use_count + 1, last_used_at = ? where id = ?')
    for (const id of ids) stmt.run(now(), id)
  }

  forget(id: MemoryId): void {
    this.db.prepare('delete from memory where id = ?').run(id)
  }

  setPinned(id: MemoryId, pinned: boolean): void {
    this.db.prepare('update memory set pinned = ? where id = ?').run(toBool(pinned), id)
  }

  expire(id: MemoryId, when: string = now()): void {
    this.db.prepare('update memory set expires_at = ? where id = ?').run(when, id)
  }

  /**
   * A window on the archives, for the curator. Ordered oldest first so that
   * consolidating a batch works through history rather than skimming the top.
   */
  browse(options: { layer?: MemoryLayer; scope?: MemoryScope; limit?: number; includeExpired?: boolean } = {}): MemoryRecord[] {
    const where: string[] = []
    const params: unknown[] = []
    if (options.layer) { where.push('layer = ?'); params.push(options.layer) }
    if (options.scope) { where.push('scope = ?'); params.push(options.scope) }
    if (!options.includeExpired) { where.push('(expires_at is null or expires_at > ?)'); params.push(now()) }
    const sql = `select * from memory ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at limit ?`
    return allAs<MemoryRow>(this.db.prepare(sql), ...params, options.limit ?? 50).map((r) =>
      hydrateMemory(r, this.buildingId),
    )
  }

  /** What the archives look like, for the owner and for deciding to curate. */
  archiveStats(): { total: number; byLayer: Record<string, number>; pinned: number; expired: number } {
    const byLayer: Record<string, number> = {}
    for (const row of allAs<{ layer: string; n: number }>(
      this.db.prepare('select layer, count(*) as n from memory group by layer'),
    )) {
      byLayer[row.layer] = row.n
    }
    return {
      total: this.memoryCount(),
      byLayer,
      pinned: getAs<{ n: number }>(this.db.prepare('select count(*) as n from memory where pinned = 1'))!.n,
      expired: getAs<{ n: number }>(
        this.db.prepare('select count(*) as n from memory where expires_at is not null and expires_at <= ?'),
        now(),
      )!.n,
    }
  }

  memoryCount(): number {
    return getAs<{ n: number }>(this.db.prepare('select count(*) as n from memory'))!.n
  }
}

// ---- row shapes and hydration ---------------------------------------------

interface FloorRow { id: string; level: number; role: string; name: string; charter: string; posting: string; tools: string; hired_at: string; vacated_at: string | null }
interface TaskRow { id: string; assigned_by: string; assigned_to: string; goal: string; acceptance: string; limits: string; state: string; result: string | null; created_at: string; settled_at: string | null }
interface MessageRow { id: string; kind: string; sender: string; recipient: string; in_reply_to: string | null; body: string; read_at: string | null; created_at: string }
interface ApprovalRow { id: string; kind: string; requested_by: string; intent: string; payload: string | null; state: string; decided_at: string | null; created_at: string }
interface MemoryRow { id: string; scope: string; layer: string; floor_id: string | null; text: string; source: string; pinned: number; confidence: number; use_count: number; last_used_at: string | null; expires_at: string | null; created_at: string }

const hydrateFloor = (r: FloorRow, building: BuildingId): Floor => ({
  id: asFloorId(r.id), building, level: r.level, role: r.role as FloorRole, name: r.name,
  charter: r.charter, posting: fromJson<Posting>(r.posting, { provider: '', model: '', engine: 'direct' }),
  tools: fromJson<string[]>(r.tools, []), hiredAt: r.hired_at, vacatedAt: r.vacated_at,
})

const hydrateTask = (r: TaskRow, building: BuildingId): Task => ({
  id: asTaskId(r.id), building, assignedBy: asFloorId(r.assigned_by), assignedTo: asFloorId(r.assigned_to),
  goal: r.goal, acceptance: fromJson<string[]>(r.acceptance, []), limits: fromJson<TaskLimits>(r.limits, DEFAULT_LIMITS),
  state: r.state as TaskState, result: r.result ? fromJson<TaskResult>(r.result, null as never) : null,
  createdAt: r.created_at, settledAt: r.settled_at,
})

const hydrateMessage = (r: MessageRow, building: BuildingId): Message => ({
  id: asMessageId(r.id), building, kind: r.kind as MessageKind, from: asFloorId(r.sender), to: asFloorId(r.recipient),
  inReplyTo: r.in_reply_to ? asMessageId(r.in_reply_to) : null, body: r.body, readAt: r.read_at, createdAt: r.created_at,
})

const hydrateApproval = (r: ApprovalRow, building: BuildingId): Approval => ({
  id: asApprovalId(r.id), building, kind: r.kind as Approval['kind'], requestedBy: asFloorId(r.requested_by),
  intent: r.intent, payload: r.payload ? fromJson<ApprovalPayload>(r.payload, { do: 'nothing' }) : null,
  state: r.state as Approval['state'], decidedAt: r.decided_at, createdAt: r.created_at,
})

const hydrateMemory = (r: MemoryRow, building: BuildingId): MemoryRecord => ({
  id: asMemoryId(r.id), scope: r.scope as MemoryScope, layer: r.layer as MemoryLayer,
  floor: r.floor_id ? asFloorId(r.floor_id) : null, building, text: r.text, source: r.source,
  pinned: fromBool(r.pinned), confidence: r.confidence, useCount: r.use_count,
  lastUsedAt: r.last_used_at, expiresAt: r.expires_at, createdAt: r.created_at,
})
