import type { BuildingId, FloorId, MessageId, TaskId, ApprovalId } from './ids.js'
import type { EscalationKind } from '../tools/context.js'

/**
 * Agents do not converse. Delegation writes a record: a goal, how it will be
 * judged, what it may spend, and when it must give up.
 */
export interface Task {
  id: TaskId
  building: BuildingId
  assignedBy: FloorId
  assignedTo: FloorId
  goal: string
  /** How the assignee — and the reviewer — will know it is done. */
  acceptance: readonly string[]
  /** Guardrails. Exceeding any of these escalates rather than spends more. */
  limits: TaskLimits
  state: TaskState
  /** Set once the work returns. */
  result: TaskResult | null
  createdAt: string
  settledAt: string | null
}

export interface TaskLimits {
  tokens: number
  /** Wall-clock seconds before the task is abandoned. */
  timeoutSeconds: number
  /** How many further hand-offs this task may spawn. Zero means it must be done in person. */
  depth: number
}

export type TaskState =
  | 'queued'
  | 'working'
  | 'awaiting-review'
  | 'awaiting-approval'
  | 'done'
  /**
   * Finished, and nobody read it — and nobody is going to.
   *
   * A review only ever happens inside a run: the work settles to
   * `awaiting-review` and the reviewer is asked in the next breath. If the run
   * dies in between, nothing outside a run will ever ask them again, so the
   * task sat in `awaiting-review` for good.
   *
   * Neither obvious answer is honest. Queueing it again redoes work that was
   * done and paid for; `done` claims an acceptance nobody gave. This says the
   * true thing instead — the work is finished, it was never read, and it is on
   * the owner's desk now. They accept it or they send it back, and either way
   * somebody actually decided.
   */
  | 'unread'
  | 'escalated'
  | 'abandoned'

export interface TaskResult {
  summary: string
  /** Branch names, file paths, URLs — whatever the work produced. */
  artifacts: readonly string[]
  tokensSpent: number
}

/**
 * A tuple rather than a bare union, because the list is needed at runtime: what
 * arrives in a request body is a string, and a string cast to this type is a
 * note saying nobody checked. One list, and `asMessageKind` is the only way in.
 */
export const MESSAGE_KINDS = [
  'task',
  'question',
  'answer',
  'review_request',
  'status',
  'artifact',
  'escalation',
  /** Neither a question nor a report. Somebody had something to say. */
  'note',
] as const

export type MessageKind = (typeof MESSAGE_KINDS)[number]

/**
 * Whatever came in, as a kind of message.
 *
 * Anything unrecognised is a note, which is what an unclassified message
 * actually is — better than storing a word the rest of the product has never
 * heard of and rendering it raw at somebody.
 */
export const asMessageKind = (value: unknown): MessageKind =>
  MESSAGE_KINDS.includes(value as MessageKind) ? (value as MessageKind) : 'note'

/**
 * One end of a message.
 *
 * Null is the owner. They are not a floor and must not be given one — a floor
 * is a hire, it counts toward the headcount, and it changes the shape of the
 * building. Null says the true thing instead: the correspondent who does not
 * work here.
 */
export type Correspondent = FloorId | null

/** Reads better than a bare null at a call site. */
export const OWNER: Correspondent = null

export const isOwner = (who: Correspondent): boolean => who === null

export interface Message {
  id: MessageId
  building: BuildingId
  kind: MessageKind
  from: Correspondent
  to: Correspondent
  /** Threads a reply to what it answers. */
  inReplyTo: MessageId | null
  body: string
  readAt: string | null
  createdAt: string
}

/**
 * What a docket can be about. One list, not two.
 *
 * There were two: this one, with six kinds, and `EscalationKind` — the same six
 * plus `shell`, which is the commonest of the lot. They met at a cast to
 * `'publish'`, which silenced the compiler and let `shell` through into the
 * database regardless, so the owner's approval desk showed three dockets all
 * reading SHELL under a heading that said they were something else. A cast is
 * not a conversion; it is a note saying nobody checked.
 */
export type ApprovalKind = EscalationKind

/**
 * How each kind is said.
 *
 * A docket is a sentence somebody reads in a hurry, and `SHELL` is not a
 * sentence. Each phrase completes "This ___", and each also stands on its own
 * as the label at the top of the docket, so the page and the terminal can read
 * one table instead of each keeping its own — which is how the page came to
 * have no phrase at all for the commonest kind, and told the owner that every
 * single request "reaches outside the building".
 */
export const KIND_SAID: Record<ApprovalKind, string> = {
  shell: 'runs a command',
  publish: 'leaves the building',
  send: 'goes to somebody outside',
  deploy: 'reaches the world',
  spend: 'costs money',
  merge: 'lands on main',
  hire: 'takes somebody on, and the building grows a storey',
}

/**
 * The same table, but total: a kind read back out of a database is only a
 * string, and a docket from an older version must still read as English.
 */
export const saidKind = (kind: string): string =>
  KIND_SAID[kind as ApprovalKind] ?? 'reaches outside the building'

/** How the shell tool words what it is asking about. */
const RUN_PREFIX = /^\s*run:\s*/i

/**
 * The thing itself, where the docket is about a literal thing.
 *
 * A shell escalation's intent is written `Run: <command>`, and the command is
 * the only part of it the owner actually has to read — "this reaches outside
 * the building" is true of every docket and helps with none of them. Pulled out
 * here rather than in the page, so the page and the terminal show the same
 * thing and neither has to know how the tool phrases itself. Null when the
 * wording does not match, so a docket loses the command rather than showing a
 * mangled one.
 */
export function commandIn(approval: Pick<Approval, 'kind' | 'intent'>): string | null {
  if (approval.kind !== 'shell') return null
  const match = RUN_PREFIX.exec(approval.intent)
  if (!match) return null
  const command = approval.intent.slice(match[0].length).trim()
  return command.length > 0 ? command : null
}

/**
 * Anything that reaches the world outside the building stops at the lobby desk
 * and waits for a person.
 */
export interface Approval {
  id: ApprovalId
  building: BuildingId
  kind: ApprovalKind
  requestedBy: FloorId
  /** What will happen if this is granted, in plain language. */
  intent: string
  /**
   * What granting it actually does. An approval that records only a sentence
   * cannot be acted on — somebody has to re-type what was agreed to.
   */
  payload: ApprovalPayload | null
  state: 'pending' | 'granted' | 'refused'
  decidedAt: string | null
  createdAt: string
}

export type ApprovalPayload =
  | { do: 'hire'; role: string; name: string; charter: string }
  | { do: 'nothing' }
