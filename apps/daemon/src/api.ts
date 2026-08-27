import {
  SkylineStore, BuildingStore, pursueGoal, curate, tierOf, nextTierAt, renderSkyline,
  rosterFor, ROSTER, FOUNDING_ROLES, allTiers, defaultPosting, discoverProviders, describePosting, probeProvider,
  parseEvery, parseAtTime, describeSchedule, ask,
  citySvg, portraitSvg, designFor,
  readBridgeConfig, writeBridgeConfig, describeToken, listGuilds, listChannels,
  PROVIDERS, TOOLS_FOR_ROLE, claudeExecutable, isRepo,
  type Building, type BuildingId, type FloorRole, type ApprovalId, type FloorId,
  type Floor, type Task, type MessageId,
} from '@app/core'
import { Router, HttpError, badRequest, notFound, readJson, type Ctx } from './router.js'
import type { EventStream } from './events.js'

/** One goal at a time per building. Two managers assigning at once is chaos. */
const working = new Set<string>()

/**
 * What one floor is doing, worked out from the work it holds.
 *
 * There is no status column, deliberately: a stored status is a second source of
 * truth that goes stale the moment a process dies holding it. The tasks table
 * already knows, and it survives a crash.
 */
export type FloorState = 'working' | 'next' | 'review' | 'blocked' | 'idle'

const RANK: Record<FloorState, number> = { working: 0, blocked: 1, review: 2, next: 3, idle: 4 }

function floorStates(staff: readonly Floor[], open: readonly Task[]): Map<string, { state: FloorState; task: Task | null }> {
  const out = new Map<string, { state: FloorState; task: Task | null }>()
  for (const floor of staff) out.set(floor.id, { state: 'idle', task: null })

  for (const task of open) {
    const held = out.get(task.assignedTo)
    if (!held) continue
    const state: FloorState =
      task.state === 'working' ? 'working'
      : task.state === 'escalated' ? 'blocked'
      : task.state === 'awaiting-review' || task.state === 'awaiting-approval' ? 'review'
      : 'next'
    // A floor holding several things is described by the most pressing of them.
    if (RANK[state] < RANK[held.state]) out.set(task.assignedTo, { state, task })
  }
  return out
}

/** The buildings, with everything the skyline needs to draw itself. */
function skylineViews(sky: SkylineStore) {
  return sky.list().map((building) => {
    const store = BuildingStore.open(building.id)
    try {
      const headcount = store.headcount()
      const open = store.openTasks()
      const pending = store.pendingApprovals().length
      const inHand = open.filter((t) => t.state === 'queued' || t.state === 'working').length
      return {
        id: building.id as string,
        name: building.name,
        headcount,
        tier: tierOf(Math.max(1, headcount)).name,
        nextTierAt: nextTierAt(Math.max(1, headcount)),
        working: store.busyFloors(),
        waiting: pending,
        busy: working.has(building.id),
        open: inHand,
        pendingApprovals: pending,
        note: inHand > 0 ? `${inHand} in hand` : `${headcount} on staff`,
      }
    } finally {
      store.close()
    }
  })
}

export const isWorking = (buildingId: string): boolean => working.has(buildingId)

/**
 * Start a goal and return immediately.
 *
 * Shared by the HTTP endpoint and the scheduler, because two ways of starting
 * the same thing is two sets of guards to keep in step. A goal takes minutes; a
 * request that waits for it is one a laptop lid will end halfway.
 */
export function startGoal(
  events: EventStream,
  building: Building,
  goal: string,
  options: { approveEverything?: boolean; source?: string } = {},
): void {
  const sky = SkylineStore.open()
  const store = BuildingStore.open(building.id)

  working.add(building.id)
  events.emit({ kind: 'goal-started', building: building.id, detail: goal, data: { source: options.source ?? 'owner' } })

  void pursueGoal(
    {
      building, store, credentials: sky,
      ask: async (kind, intent) => {
        const manager = store.floorByRole('manager')
        if (manager) store.requestApproval({ kind: kind as 'publish', by: manager.id, intent })
        events.emit({ kind: 'asked', building: building.id, detail: intent })
        return options.approveEverything === true
      },
      report: (line) => events.emit({ kind: 'progress', building: building.id, detail: line }),
      onEvent: (floor, event) =>
        events.emit({ kind: event.kind, building: building.id, floor: floor.id, detail: event.detail }),
    },
    goal,
  )
    .then((outcome) => {
      events.emit({
        kind: 'goal-finished', building: building.id, detail: outcome.managerSummary,
        data: { worked: outcome.worked.length, tokens: outcome.tokensSpent, outstanding: outcome.outstanding },
      })
    })
    .catch((error: unknown) => {
      events.emit({ kind: 'goal-failed', building: building.id, detail: (error as Error).message })
    })
    .finally(() => {
      working.delete(building.id)
      store.close()
      sky.close()
    })
}

/** What the daemon's Discord bridge exposes to the API, and nothing more. */
export interface BridgeHandle {
  reload(): void
  readonly status: { state: string; detail?: string; as?: string; since?: string }
}

export function buildApi(events: EventStream, bridge?: BridgeHandle): Router {
  const router = new Router()

  const skyline = () => SkylineStore.open()

  const buildingOr404 = (sky: SkylineStore, id: string): Building => {
    const found = sky.get(id as BuildingId) ?? sky.byName(id)
    if (!found) throw notFound(`building "${id}"`)
    return found
  }

  router.get('/api/health', () => ({
    ok: true,
    claudeCode: Boolean(claudeExecutable()),
    watching: events.watching,
  }))

  /**
   * The skyline as drawn text. One source of truth for the art: the dashboard
   * shows exactly what the terminal shows, because both ask for the same string.
   */
  router.get('/api/skyline/art', () => {
    const sky = skyline()
    try {
      const views = sky.list().map((building) => {
        const store = BuildingStore.open(building.id)
        try {
          const headcount = Math.max(1, store.headcount())
          const open = store.tasks({ state: 'queued' }).length + store.tasks({ state: 'working' }).length
          return {
            name: building.name,
            headcount,
            working: store.busyFloors(),
            note: open > 0 ? `${open} in hand` : `${store.headcount()} on staff`,
          }
        } finally {
          store.close()
        }
      })
      return { art: renderSkyline(views, { colour: false }) }
    } finally {
      sky.close()
    }
  })

  router.get('/api/skyline', () => {
    const sky = skyline()
    try {
      return {
        buildings: skylineViews(sky).map((view) => ({
          ...view,
          // This endpoint predates the drawn city and named things the other
          // way round: `busy` was the count of floors with work, `working` the
          // flag for a goal in flight. The drawn city wants the opposite sense
          // of both, so the two names are swapped back here rather than
          // changing what an existing caller gets. The dashboard does not read
          // this one — it asks /api/skyline/city, which is already in the new
          // shape — and neither does the CLI, which opens the stores directly.
          busy: view.working,
          working: view.busy,
        })),
        owner: sky.owner(),
      }
    } finally {
      sky.close()
    }
  })

  /**
   * The skyline, drawn.
   *
   * Rendered here rather than in the browser so that the page cannot invent a
   * building the rest of the product has never heard of. The page's job is to
   * put this string on the screen and notice which one was clicked.
   */
  router.get('/api/skyline/city', (ctx) => {
    const sky = skyline()
    try {
      const views = skylineViews(sky)
      // The page says how much room it has; a drawing that does not fill it
      // reads as one that failed to load. Clamped so a nonsense query string
      // cannot ask for a canvas nothing can render.
      const asked = (name: string, max: number) => {
        const value = Number(ctx.query.get(name))
        return Number.isFinite(value) && value > 0 ? { [name]: Math.min(Math.round(value), max) } : {}
      }
      return {
        svg: citySvg(views, { ...asked('width', 6000), ...asked('height', 3000) }),
        buildings: views,
        owner: sky.owner(),
      }
    } finally {
      sky.close()
    }
  })

  router.get('/api/buildings/:id', (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        const headcount = store.headcount()
        const staff = store.staff()
        const open = store.openTasks()
        const recent = store.recentTasks(12)
        const states = floorStates(staff, open)
        const design = designFor({ id: building.id, name: building.name, headcount })

        return {
          ...building,
          tier: tierOf(Math.max(1, headcount)).name,
          nextTierAt: nextTierAt(Math.max(1, headcount)),
          headcount,
          look: { palette: design.palette.name, crown: design.crown, accent: design.accent },
          portrait: portraitSvg({
            id: building.id,
            name: building.name,
            headcount,
            working: store.busyFloors(),
            waiting: store.pendingApprovals().length,
            busy: working.has(building.id),
          }),
          staff: staff.map((floor) => {
            const held = states.get(floor.id)
            return {
              id: floor.id, name: floor.name, role: floor.role, level: floor.level,
              posting: floor.posting, describes: describePosting(floor.posting),
              hiredAt: floor.hiredAt,
              state: held?.state ?? 'idle',
              on: held?.task ? { id: held.task.id, goal: held.task.goal, state: held.task.state } : null,
            }
          }),
          open,
          recent,
          // The old field, still the last forty in creation order, because the
          // CLI reads it and a screen is not a reason to break a terminal.
          tasks: store.tasks().slice(-40),
          approvals: store.pendingApprovals(),
          archives: store.archiveStats(),
          spent: store.spentSince('1970-01-01T00:00:00.000Z'),
          spentThisMonth: store.spentThisMonth(),
          working: working.has(building.id),
        }
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings', async (ctx) => {
    const input = await ctx.body<{ name?: string; charter?: string; workspace?: string }>()
    if (!input.name) throw badRequest('A building needs a name.')
    if (!input.workspace) throw badRequest('A building needs a workspace directory.')

    const sky = skyline()
    try {
      if (sky.byName(input.name)) throw new HttpError(409, `There is already a building called "${input.name}".`)
      const building = sky.breakGround({
        name: input.name,
        charter: input.charter ?? input.name,
        workspace: input.workspace,
        repos: isRepo(input.workspace) ? [input.workspace] : [],
      })

      const store = BuildingStore.open(building.id)
      let hired = 0
      try {
        // FOUNDING_ROLES, not a list written out again here. This endpoint had
        // its own copy and kept hiring a manager and a hiring manager long after
        // the CLI stopped — so buildings made from the dashboard were founded
        // with nobody who could be given the work.
        const available = await discoverProviders(sky)
        for (const role of FOUNDING_ROLES) {
          const entry = rosterFor(role)
          const posting = entry ? defaultPosting(role, available) : null
          if (entry && posting) {
            store.hire({ role, name: entry.suggestedName, charter: entry.charter, posting, tools: TOOLS_FOR_ROLE[role] ?? [] })
            hired += 1
          }
        }
      } finally {
        store.close()
      }

      events.emit({ kind: 'ground-broken', building: building.id, detail: building.name })
      // A building founded with nobody in it is a dead end, and the reason is
      // never in the building — it is that no provider could be reached, so
      // there was nothing to post a manager to. Saying so here is the
      // difference between a confusing empty room and one obvious next step.
      return hired > 0
        ? building
        : {
            ...building,
            warning:
              'Nobody could be taken on: no model provider is set up yet, so there is nothing to post a manager to. ' +
              'Install Claude Code, set an API key, or start Ollama, then hire from inside the building.',
          }
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings/:id/hire', async (ctx) => {
    const input = await ctx.body<{ role?: string; name?: string }>()
    const entry = input.role ? rosterFor(input.role as FloorRole) : undefined
    if (!entry) throw badRequest(`No such role as "${input.role}".`)

    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        const posting = defaultPosting(entry.role, await discoverProviders(sky))
        if (!posting) throw new HttpError(422, `No provider set up that suits a ${entry.role}.`)
        const before = store.headcount()
        const floor = store.hire({
          role: entry.role, name: input.name ?? entry.suggestedName,
          charter: entry.charter, posting, tools: TOOLS_FOR_ROLE[entry.role] ?? [],
        })
        const after = store.headcount()
        events.emit({
          kind: 'hired', building: building.id, floor: floor.id,
          detail: `${floor.name} joins as ${entry.role}`,
          data: { headcount: after, tier: tierOf(after).name, grew: tierOf(before).name !== tierOf(after).name },
        })
        return floor
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings/:id/goal', async (ctx) => {
    const input = await ctx.body<{ goal?: string; approveEverything?: boolean }>()
    if (!input.goal) throw badRequest('What do you want done?')

    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      if (working.has(building.id)) throw new HttpError(409, `${building.name} is already working on something.`)

      const store = BuildingStore.open(building.id)
      const empty = store.headcount() === 0
      // The in-memory flag only knows about this process. Somebody at a terminal
      // holds the claim in the database, and the endpoint should refuse rather
      // than start and fail a moment later on the stream.
      const heldBy = store.claimHolder()
      // Checked here as well as inside the run: without it the caller is told
      // the work started and then watches it fail on the stream a moment later,
      // which is a worse answer than a refusal.
      const allowance = building.budget.monthlyTokens
      const spent = allowance === null ? 0 : store.spentThisMonth()
      store.close()

      if (heldBy !== null) {
        throw new HttpError(409, `${building.name} is already being worked on (${heldBy}).`)
      }
      if (empty) throw new HttpError(422, `${building.name} has nobody in it yet.`)
      if (allowance !== null && spent >= allowance) {
        throw new HttpError(
          422,
          `${building.name} has spent ${spent.toLocaleString()} of its ${allowance.toLocaleString()} output tokens this month.`,
        )
      }

      startGoal(events, building, input.goal, {
        ...(input.approveEverything === true ? { approveEverything: true } : {}),
      })
      return { started: true, building: building.id, watch: '/api/events' }
    } finally {
      sky.close()
    }
  })

  /**
   * Ask the concierge. Answers immediately; anything it hands to a building runs
   * on afterwards and is watched on the event stream like any other goal.
   */
  router.post('/api/ask', async (ctx) => {
    const input = await ctx.body<{ question?: string }>()
    if (!input.question) throw badRequest('What would you like to know?')

    const sky = skyline()
    try {
      const result = await ask({
        question: input.question,
        credentials: sky,
        owner: sky.owner(),
        onTool: (name) => events.emit({ kind: 'looking', detail: name }),
        startGoal: async (buildingId, goal) => {
          const target = sky.get(buildingId)
          if (!target) return `There is no building ${buildingId}.`
          if (working.has(target.id)) return `${target.name} is already working on something.`

          const store = BuildingStore.open(target.id)
          const staffed = store.headcount() > 0
          const heldBy = store.claimHolder()
          store.close()
          if (!staffed) return `${target.name} has nobody in it yet.`
          if (heldBy !== null) return `${target.name} is already being worked on.`

          startGoal(events, target, goal, { source: 'concierge' })
          return `Handed to ${target.name}. It is being worked on now.`
        },
      })
      events.emit({ kind: 'answered', detail: result.answer.slice(0, 200) })
      return result
    } finally {
      sky.close()
    }
  })

  // ---- standing orders ----------------------------------------------------

  router.get('/api/schedules', () => {
    const sky = skyline()
    try {
      const names = new Map(sky.list().map((b) => [b.id as string, b.name]))
      return {
        schedules: sky.schedules().map((schedule) => ({
          ...schedule,
          buildingName: names.get(schedule.building) ?? schedule.building,
          reads: describeSchedule(schedule),
        })),
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings/:id/schedules', async (ctx) => {
    const input = await ctx.body<{ goal?: string; every?: string; at?: string }>()
    if (!input.goal) throw badRequest('A standing order needs a goal.')
    const everyMinutes = parseEvery(input.every ?? 'daily')
    if (everyMinutes === null) throw badRequest(`"${input.every}" is not an interval I can read. Try 30m, 4h, daily or weekly.`)
    if (input.at !== undefined && parseAtTime(input.at) === null) {
      throw badRequest(`"${input.at}" is not a time of day. Try 09:00.`)
    }

    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const schedule = sky.schedule({
        building: building.id, goal: input.goal, everyMinutes,
        atTime: input.at ?? null,
      })
      events.emit({ kind: 'scheduled', building: building.id, detail: `${describeSchedule(schedule)}: ${input.goal}` })
      return schedule
    } finally {
      sky.close()
    }
  })

  router.post('/api/schedules/:id', async (ctx) => {
    const input = await ctx.body<{ enabled?: boolean; remove?: boolean }>()
    const sky = skyline()
    try {
      const found = sky.schedules().find((s) => s.id === ctx.params.id)
      if (!found) throw notFound(`standing order "${ctx.params.id}"`)
      if (input.remove === true) sky.unschedule(found.id)
      else if (input.enabled !== undefined) sky.setScheduleEnabled(found.id, input.enabled)
      return { ok: true }
    } finally {
      sky.close()
    }
  })

  // ---- the mailroom -------------------------------------------------------

  /**
   * The correspondence, with the names filled in.
   *
   * Ids are what the database holds and names are what a person reads, so the
   * translation happens here rather than in the page — the page does not have
   * the staff list of a building it is not looking at.
   */
  router.get('/api/buildings/:id/mail', (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        const staff = new Map(store.staff({ includeVacated: true }).map((f) => [f.id as string, f]))
        const named = (who: string | null) => {
          if (who === null) return { id: null, name: sky.owner().name || 'You', role: 'owner' }
          const floor = staff.get(who)
          return floor
            ? { id: floor.id, name: floor.name, role: floor.role }
            : { id: who, name: 'somebody who has left', role: 'former staff' }
        }
        const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit')) || 60))
        return {
          messages: store.conversation({ limit }).map((message) => ({
            id: message.id,
            kind: message.kind,
            from: named(message.from),
            to: named(message.to),
            body: message.body,
            inReplyTo: message.inReplyTo,
            readAt: message.readAt,
            createdAt: message.createdAt,
            /** The owner is null at either end; the page colours those differently. */
            mine: message.from === null,
          })),
          unread: store.unreadCounts(),
          staff: store.staff().map((f) => ({ id: f.id, name: f.name, role: f.role })),
        }
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  /** The owner writes to a floor. This is the half of the bus that was missing. */
  router.post('/api/buildings/:id/mail', async (ctx) => {
    const input = await ctx.body<{ to?: string; body?: string; kind?: string; inReplyTo?: string }>()
    if (!input.body?.trim()) throw badRequest('An empty message is not worth sending.')

    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        // Addressed to a floor by id, or to whoever runs the place.
        const to = input.to && input.to !== 'manager'
          ? store.floor(input.to as FloorId)
          : store.floorByRole('manager')
        if (!to) throw notFound(`floor "${input.to ?? 'manager'}"`)
        if (to.vacatedAt) throw badRequest(`${to.name} no longer works here.`)

        const message = store.post({
          kind: (input.kind as 'note') ?? 'note',
          from: null,
          to: to.id,
          body: input.body.trim().slice(0, 4000),
          ...(input.inReplyTo ? { inReplyTo: input.inReplyTo as MessageId } : {}),
        })
        events.emit({
          kind: 'posted', building: building.id, floor: to.id,
          detail: `to ${to.name}: ${input.body.trim().slice(0, 120)}`,
          data: { from: 'owner' },
        })
        return { ...message, toName: to.name }
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  /** The owner has read their post. */
  router.post('/api/buildings/:id/mail/read', (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        return { marked: store.markAllRead(null) }
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  // ---- the Discord bridge -------------------------------------------------

  /**
   * How the bridge is set up, and how it is getting on.
   *
   * The token never comes back out — only enough of it to recognise which one
   * is stored. A screen that can show you a bot token is a screenshot away from
   * giving it to somebody else.
   */
  router.get('/api/bridge', () => {
    const sky = skyline()
    try {
      const config = readBridgeConfig(sky)
      const names = new Map(sky.list().map((b) => [b.id as string, b.name]))
      return {
        connected: config.token !== null,
        token: describeToken(config),
        tokenKind: config.tokenKind,
        guild: config.guild,
        mirrorAll: config.mirrorAll,
        enabled: config.enabled,
        wired: Object.entries(config.channels).map(([building, channel]) => ({
          building, channel, buildingName: names.get(building) ?? building,
        })),
        status: bridge?.status ?? { state: 'off', detail: 'This daemon has no bridge.' },
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/bridge', async (ctx) => {
    const input = await ctx.body<{
      token?: string | null; tokenKind?: 'literal' | 'env' | 'none'
      guild?: string | null; mirrorAll?: boolean; enabled?: boolean
      wire?: { building: string; channel: string | null }
    }>()

    const sky = skyline()
    try {
      const current = readBridgeConfig(sky)
      const patch: Parameters<typeof writeBridgeConfig>[1] = {}
      if (input.token !== undefined) patch.token = input.token
      if (input.tokenKind !== undefined) patch.tokenKind = input.tokenKind
      if (input.guild !== undefined) patch.guild = input.guild
      if (input.mirrorAll !== undefined) patch.mirrorAll = input.mirrorAll
      if (input.enabled !== undefined) patch.enabled = input.enabled

      if (input.wire) {
        const building = buildingOr404(sky, input.wire.building)
        const channels = { ...current.channels }
        // A null channel unwires it, rather than leaving a mapping to nowhere.
        if (input.wire.channel) channels[building.id] = input.wire.channel
        else delete channels[building.id]
        patch.channels = channels
      }

      const config = writeBridgeConfig(sky, patch)
      bridge?.reload()
      events.emit({ kind: 'bridge-changed', detail: config.enabled ? 'settings saved' : 'switched off' })
      return { ok: true, connected: config.token !== null, token: describeToken(config) }
    } finally {
      sky.close()
    }
  })

  /** The servers and channels the bot can see, so nobody has to copy an id. */
  router.get('/api/bridge/places', async () => {
    const sky = skyline()
    try {
      const config = readBridgeConfig(sky)
      if (!config.token) throw badRequest('Set a bot token first.')
      const guilds = await listGuilds(config.token)
      const guild = config.guild ?? guilds[0]?.id ?? null
      return {
        guilds,
        guild,
        channels: guild ? await listChannels(config.token, guild) : [],
      }
    } catch (error) {
      throw new HttpError(422, (error as Error).message)
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings/:id/curate', async (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        const result = await curate({ building, store, credentials: sky, available: await discoverProviders(sky) })
        events.emit({ kind: 'curated', building: building.id, detail: result.summary })
        return result
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  router.get('/api/buildings/:id/archives', (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        const query = ctx.query.get('q')
        return {
          stats: store.archiveStats(),
          notes: query ? store.recallByKeyword(query, { limit: 25 }) : store.browse({ limit: 25 }),
        }
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  router.get('/api/approvals', () => {
    const sky = skyline()
    try {
      return {
        pending: sky.list().flatMap((building) => {
          const store = BuildingStore.open(building.id)
          try {
            return store.pendingApprovals().map((approval) => ({ ...approval, buildingName: building.name }))
          } finally {
            store.close()
          }
        }),
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/approvals/:id', async (ctx) => {
    const input = await ctx.body<{ granted?: boolean }>()
    const sky = skyline()
    try {
      for (const building of sky.list()) {
        const store = BuildingStore.open(building.id)
        try {
          const match = store.pendingApprovals().find((a) => a.id === ctx.params.id)
          if (!match) continue
          store.decide(match.id as ApprovalId, input.granted === true)

          if (input.granted === true && match.payload?.do === 'hire') {
            const entry = rosterFor(match.payload.role as FloorRole)
            const posting = entry ? defaultPosting(entry.role, await discoverProviders(sky)) : null
            if (entry && posting) {
              const floor = store.hire({
                role: entry.role, name: match.payload.name || entry.suggestedName,
                charter: match.payload.charter || entry.charter, posting,
                tools: TOOLS_FOR_ROLE[entry.role] ?? [],
              })
              events.emit({ kind: 'hired', building: building.id, floor: floor.id, detail: `${floor.name} joins as ${entry.role}` })
              return { decided: true, hired: floor }
            }
          }
          events.emit({ kind: 'decided', building: building.id, detail: `${input.granted ? 'Approved' : 'Refused'}: ${match.intent}` })
          return { decided: true }
        } finally {
          store.close()
        }
      }
      throw notFound(`approval "${ctx.params.id}"`)
    } finally {
      sky.close()
    }
  })

  /** Who can be hired, and what each is for. The hiring screen needs both. */
  router.get('/api/roles', () => ({
    roles: ROSTER.map((entry) => ({
      role: entry.role,
      name: entry.suggestedName,
      summary: entry.summary,
    })),
  }))

  /** The forms a building passes through, so the page can show what is next. */
  router.get('/api/tiers', () => ({
    tiers: allTiers().map((tier) => ({ name: tier.name, blurb: tier.blurb })),
  }))

  router.get('/api/providers', async () => {
    const sky = skyline()
    try {
      return {
        claudeCode: Boolean(claudeExecutable()),
        providers: await Promise.all(
          PROVIDERS.map(async (spec) => ({
            name: spec.name, label: spec.label, note: spec.note,
            suggested: spec.suggested, needsKey: spec.needsKey,
            status: await probeProvider(spec.name, sky),
          })),
        ),
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings/:id/floors/:floor/posting', async (ctx) => {
    const input = await ctx.body<{ provider?: string; model?: string; engine?: string }>()
    if (!input.provider || !input.model) throw badRequest('A posting needs a provider and a model.')
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      const store = BuildingStore.open(building.id)
      try {
        const floor = store.floor(ctx.params.floor as FloorId)
        if (!floor) throw notFound(`floor "${ctx.params.floor}"`)
        const engine = input.engine === 'claude-agent-sdk' && claudeExecutable() ? 'claude-agent-sdk' : 'direct'
        store.repost(floor.id, { provider: input.provider, model: input.model, engine })
        return store.floor(floor.id)
      } finally {
        store.close()
      }
    } finally {
      sky.close()
    }
  })

  return router
}

export const readBody = readJson
export type { Ctx }
