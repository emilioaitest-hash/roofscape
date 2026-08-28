import {
  SkylineStore, BuildingStore, pursueGoal, curate, tierOf, nextTierAt, renderSkyline,
  rosterFor, ROSTER, FOUNDING_ROLES, allTiers, defaultPosting, discoverProviders, describePosting, probeProvider,
  parseEvery, parseAtTime, describeSchedule, ask,
  citySvg, portraitSvg, designFor, floorsSaid,
  readBridgeConfig, writeBridgeConfig, describeToken, listGuilds, listChannels,
  PROVIDERS, TOOLS_FOR_ROLE, claudeExecutable, isRepo, providerSpec, availableProviders,
  KIND_SAID, saidKind, commandIn, asMessageKind,
  type Building, type BuildingId, type FloorRole, type ApprovalId, type FloorId,
  type Floor, type Task, type Approval, type MessageId, type EscalationKind,
} from '@app/core'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
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

/**
 * Finished work whose reader never came.
 *
 * A review only ever happens inside a run: the orchestrator settles a task to
 * `awaiting-review` and asks the reviewer in the next breath. If the run dies
 * in between — a crash, a closed lid, a killed daemon — nothing outside a run
 * will ever ask them again, and the task sits there for good, counted as open
 * and lighting a window nobody is behind.
 *
 * Neither obvious answer is honest. Putting it back in the queue redoes work
 * that was done and paid for; marking it `done` claims an acceptance nobody
 * gave. So it stops being the building's problem and becomes the owner's: it is
 * left for them, and they accept it or send it back. Either way somebody
 * decided, which is the whole point of having a reader.
 *
 * "Nobody will read it" is read off the claim rather than off a clock. A run
 * holds the building for as long as it works and renews the hold every minute,
 * so a building nobody holds has no run alive to finish the review — which is
 * why this is safe to do on a plain read of the skyline. The only tasks it can
 * catch are ones no process is working on.
 *
 * A building with no reviewer at all is somebody else's case and is left alone:
 * `recover.ts` lets that work straight through, because the orchestrator would
 * have done the same, and two rules for one state is how they drift apart.
 */
function handBackUnreadWork(
  store: BuildingStore,
  building: { id: string; name: string },
  events?: EventStream,
): number {
  const waiting = store.tasks({ state: 'awaiting-review' })
  if (waiting.length === 0) return 0
  if (working.has(building.id) || store.claimHolder() !== null) return 0
  if (!store.floorByRole('reviewer')) return 0

  for (const task of waiting) store.setTaskState(task.id, 'unread')
  events?.emit({
    kind: 'left-unread',
    building: building.id,
    detail:
      waiting.length === 1
        ? `One finished task at ${building.name} was never read, so it is on your desk.`
        : `${waiting.length} finished tasks at ${building.name} were never read, so they are on your desk.`,
    data: { tasks: waiting.length, remedy: 'Read it and say whether it holds; nothing else will.' },
  })
  return waiting.length
}

/** The buildings, with everything the skyline needs to draw itself. */
function skylineViews(sky: SkylineStore, events?: EventStream) {
  return sky.list().map((building) => {
    const store = BuildingStore.open(building.id)
    try {
      handBackUnreadWork(store, building, events)
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
        /** Has anybody ever put a goal to it? Not the same as being idle. */
        everGivenWork: store.taskCount() > 0,
        /** Finished work nobody read. It waits on the owner, not on the building. */
        unread: store.tasks({ state: 'unread' }).length,
        note: inHand > 0 ? `${inHand} in hand` : floorsSaid(headcount),
      }
    } finally {
      store.close()
    }
  })
}

export const isWorking = (buildingId: string): boolean => working.has(buildingId)

/**
 * Runs that are standing at the approval desk, by the id of what they asked.
 *
 * The daemon used to record a docket and refuse it in the same breath, before
 * the owner could possibly have seen it — the agent was told "no", moved on,
 * and the flag on the roof went up over a decision that had already been made.
 * Deciding it later resumed nothing, because there was nothing left to resume.
 *
 * So an ask is now a promise, and this is where it waits. In memory on purpose:
 * a waiting run only exists in this process, and a docket whose run has gone is
 * a docket nobody can act on — which is why deciding one says whether anything
 * was actually waiting for the answer.
 */
const desk = new Map<string, { building: string; settle: (granted: boolean) => void }>()

/**
 * How long a run waits before taking silence for a no.
 *
 * Shorter than a turn's own deadline, so the refusal reaches the agent as an
 * answer it can act on rather than as the whole turn being cut off — and an
 * unattended building stops rather than assuming yes. Read each time so a test
 * can shorten it, and so a restart is not needed to change it.
 */
const askTimeoutMs = (): number => Number(process.env.ROOFSCAPE_ASK_TIMEOUT_MS ?? 5 * 60_000)

/** Answer a waiting run, if one is still waiting. */
function settleAsk(approvalId: string, granted: boolean): boolean {
  const waiting = desk.get(approvalId)
  if (!waiting) return false
  desk.delete(approvalId)
  waiting.settle(granted)
  return true
}

/** The run has ended; nobody is at the desk any more. Refuse what it left. */
function abandonAsks(events: EventStream, buildingId: string): void {
  for (const [id, waiting] of [...desk]) {
    if (waiting.building !== buildingId) continue
    desk.delete(id)
    waiting.settle(false)
    events.emit({
      kind: 'ask-abandoned', building: buildingId,
      detail: 'The run ended before this was answered, so it was refused.',
      data: { approval: id },
    })
  }
}

/**
 * How an agent reaches the owner mid-goal from the dashboard.
 *
 * It records the docket, raises the flag, and then genuinely waits. The CLI has
 * always done this properly by blocking on a prompt; this is the same promise,
 * settled by the approvals endpoint instead of by a keypress.
 *
 * Exported so a test can hold one open and answer it through the route, which
 * is the whole behaviour and cannot be observed from outside without a model.
 */
export function askOwner(
  events: EventStream,
  building: Building,
  store: BuildingStore,
  approveEverything: boolean,
): (kind: EscalationKind, intent: string) => Promise<boolean> {
  return (kind, intent) =>
    new Promise<boolean>((resolve) => {
      // Somebody has to be on the docket as having asked. The manager speaks for
      // the building; if there is no manager the run would not have started.
      const asker = store.floorByRole('manager') ?? store.staff()[0]
      if (!asker) {
        events.emit({ kind: 'asked', building: building.id, detail: intent })
        resolve(false)
        return
      }

      const approval = store.requestApproval({ kind, by: asker.id, intent })
      events.emit({
        kind: 'asked', building: building.id, floor: asker.id, detail: intent,
        data: { approval: approval.id, kind, waiting: !approveEverything },
      })

      if (approveEverything) {
        store.decide(approval.id, true)
        events.emit({ kind: 'decided', building: building.id, detail: `Approved in advance: ${intent}` })
        resolve(true)
        return
      }

      const patience = askTimeoutMs()
      let answered = false
      const finish = (granted: boolean) => {
        if (answered) return
        answered = true
        clearTimeout(timer)
        desk.delete(approval.id)
        resolve(granted)
      }

      const timer = setTimeout(() => {
        // The store belongs to the run and the run is still inside this ask, so
        // it is open — but a turn cut off by its own deadline can leave this
        // timer as the last thing holding the handle, and throwing in here
        // would take the daemon down rather than one goal.
        try {
          store.decide(approval.id, false)
        } catch { /* the run has already packed up; the docket stands as it is */ }
        events.emit({
          kind: 'ask-timed-out', building: building.id,
          detail: `Nobody answered in time, so this was refused: ${intent}`,
          data: { approval: approval.id, waitedMs: patience },
        })
        finish(false)
      }, patience)
      // A pending question is not a reason for the process to stay alive.
      timer.unref()

      desk.set(approval.id, { building: building.id, settle: finish })
    })
}

/**
 * Is there any way at all to reach a model from here?
 *
 * Answered without a network call, because it is wanted on the home screen:
 * a credential for a hosted provider, an installed Claude Code — which reaches
 * Anthropic on the owner's subscription and needs no key — or a local provider
 * the owner has recorded.
 */
function couldReachAModel(sky: SkylineStore): boolean {
  if (availableProviders(sky).length > 0) return true
  if (claudeExecutable()) return true
  return sky.providers().some((record) => providerSpec(record.name)?.needsKey === false)
}

/**
 * The one thing to do next, or nothing.
 *
 * A new owner's first screen was four zeros and "Click a building to go inside
 * it", which is where the app was actually abandoned: nothing anywhere said
 * *hire somebody*, and hiring somebody is the only thing that makes a building
 * do anything. First-run is a state machine, not a boolean, and this is the
 * machine — the page's job is to say it well.
 */
function nextAction(
  sky: SkylineStore,
  views: ReturnType<typeof skylineViews>,
): { do: string; say: string; building: string | null } {
  if (!couldReachAModel(sky)) {
    return {
      do: 'connect-provider',
      say: 'No model provider is set up yet, so nobody can be hired. Connect one.',
      building: null,
    }
  }
  if (views.length === 0) {
    return { do: 'break-ground', say: 'Break ground on your first building.', building: null }
  }

  const empty = views.find((view) => view.headcount === 0)
  if (empty) {
    return {
      do: 'hire',
      say: `${empty.name} has nobody in it yet. Take somebody on and it grows a storey.`,
      building: empty.id,
    }
  }

  const waiting = views.find((view) => view.pendingApprovals > 0)
  if (waiting) {
    return {
      do: 'decide',
      say: `${waiting.name} is waiting on your say-so.`,
      building: waiting.id,
    }
  }

  // After the desk, not before it: a docket has a run standing at it, and this
  // has nobody waiting — the work is done, it is only unread.
  const unread = views.find((view) => view.unread > 0)
  if (unread) {
    return {
      do: 'read-work',
      say: `${unread.name} finished something nobody read. Say whether it holds.`,
      building: unread.id,
    }
  }

  const idle = views.find((view) => !view.everGivenWork)
  if (idle) {
    return {
      do: 'set-goal',
      say: `${idle.name} is staffed and has never been asked for anything. Put a goal to it.`,
      building: idle.id,
    }
  }

  return { do: 'nothing', say: 'Nothing needs you. Go and do something else.', building: null }
}

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
      ask: askOwner(events, building, store, options.approveEverything === true),
      report: (line) => events.emit({ kind: 'progress', building: building.id, detail: line }),
      onEvent: (floor, event) =>
        events.emit({ kind: event.kind, building: building.id, floor: floor.id, detail: event.detail }),
    },
    goal,
  )
    .then((outcome) => {
      // The building has come back, and what it says is not always "finished".
      // A goal nobody could start is announced as a failure even to a page that
      // reads nothing but the event's kind, and the verdict rides alongside so
      // a page that does read it can tell "did nothing" from "did something".
      events.emit({
        kind: outcome.verdict === 'could-not-start' ? 'goal-failed' : 'goal-finished',
        building: building.id,
        detail: outcome.headline,
        data: {
          verdict: outcome.verdict,
          headline: outcome.headline,
          why: outcome.why,
          remedy: outcome.remedy,
          managerSummary: outcome.managerSummary,
          worked: outcome.worked.length,
          finished: outcome.worked.filter((item) => item.settled === 'done').length,
          tokens: outcome.tokensSpent,
          outstanding: outcome.outstanding,
        },
      })
    })
    .catch((error: unknown) => {
      // A budget reached or a building already claimed. These carry the command
      // that lifts them in the message itself, so the message is the remedy.
      const message = (error as Error).message
      events.emit({
        kind: 'goal-failed', building: building.id, detail: message,
        data: { verdict: 'could-not-start', headline: `${building.name} could not start.`, why: message, remedy: null },
      })
    })
    .finally(() => {
      abandonAsks(events, building.id)
      working.delete(building.id)
      // A run that fell over between finishing a task and reading it leaves the
      // work waiting for a review that will never be asked for. This is the
      // first moment it is knowable, so it is said here rather than at the next
      // restart.
      handBackUnreadWork(store, building, events)
      store.close()
      sky.close()
    })
}

/**
 * One docket, as the owner has to read it.
 *
 * What is stored is a kind, a sentence and an id, and a card built out of that
 * is mostly empty and says the same thing every time — the approval desk showed
 * three requests, all captioned "this reaches outside the building", all
 * labelled SHELL. So the kind goes out said rather than printed, and the thing
 * being decided goes out beside it: for a shell docket that is the command
 * itself, which is the only part anybody actually needs to read.
 *
 * Done here rather than on the page, because the terminal shows the same
 * dockets and two tables of adjectives drift apart within a week.
 */
function docketView<T extends object>(approval: Approval, extra: T) {
  return {
    ...approval,
    /** The kind, in words: "runs a command", "lands on main". */
    said: saidKind(approval.kind),
    /** The literal thing, where there is one to show. Null otherwise. */
    command: commandIn(approval),
    ...extra,
  }
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
            note: open > 0 ? `${open} in hand` : floorsSaid(store.headcount()),
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
        buildings: skylineViews(sky, events).map((view) => ({
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
      const views = skylineViews(sky, events)
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
        // The single next action, worked out here because this is the only
        // place that can see every building at once.
        next: nextAction(sky, views),
        // What has been boarded up, so the page can offer it back. Not drawn:
        // a boarded-up building is off the skyline, and half-drawing it there
        // would be a building you can see and cannot go into.
        boardedUp: sky
          .list({ includeClosed: true })
          .filter((building) => building.closedAt)
          .map((building) => ({ id: building.id as string, name: building.name, closedAt: building.closedAt })),
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
        handBackUnreadWork(store, building, events)
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
          /**
           * Finished work nobody read, which is not open — nobody in the
           * building is going to touch it again — and is not settled either.
           * It is on the owner's desk, so it is handed over separately rather
           * than buried in the last dozen things that happened.
           */
          unread: store.tasks({ state: 'unread' }),
          recent,
          // The old field, still the last forty in creation order, because the
          // CLI reads it and a screen is not a reason to break a terminal.
          tasks: store.tasks().slice(-40),
          approvals: store.pendingApprovals().map((approval) =>
            docketView(approval, { waiting: desk.has(approval.id) })),
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

    // The CLI has always resolved and checked this; coming in through the
    // dashboard did not, so a typo produced a building that looked fine and
    // failed the first time anybody gave it work. A browser has no shell to
    // expand `~` either, so that is done here rather than left as a literal
    // directory called "~".
    const workspace = resolve(
      input.workspace.trim().replace(/^~(?=$|[/\\])/, homedir()),
    )
    if (!existsSync(workspace)) {
      throw badRequest(`No such directory: ${workspace}. Make it first, or point somewhere that exists.`)
    }
    if (!statSync(workspace).isDirectory()) {
      throw badRequest(`${workspace} is a file. A building needs a directory to work in.`)
    }

    const sky = skyline()
    try {
      if (sky.byName(input.name)) throw new HttpError(409, `There is already a building called "${input.name}".`)
      const building = sky.breakGround({
        name: input.name,
        charter: input.charter ?? input.name,
        workspace,
        repos: isRepo(workspace) ? [workspace] : [],
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

  /**
   * Board a building up, and bring one back.
   *
   * Breaking ground has always been one typo away from a building you are
   * stuck with: the store could mothball one from the first commit, it was
   * tested, and nothing anywhere called it. Neither the dashboard nor the CLI
   * could take a building off the skyline.
   *
   * It is not a delete and must never become one. The floors, the archives and
   * the workspace are untouched — this sets one column, and `reopen` clears it.
   * Deleting a building means deleting its folder, which is the owner's to do
   * with `rm`, where they can see what they are removing.
   */
  router.post('/api/buildings/:id/close', (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      // Not while somebody is on a goal for it. The run holds the building's
      // stores open and would go on writing into a building that had left the
      // skyline, finishing into somewhere nobody can see.
      if (working.has(building.id)) {
        throw new HttpError(409, `${building.name} is working on something. Let it come back first.`)
      }
      if (building.closedAt) return { building, alreadyClosed: true }

      sky.boardUp(building.id)
      events.emit({
        kind: 'boarded-up',
        building: building.id,
        detail: `${building.name} is boarded up. Nothing was deleted.`,
      })
      return { building: { ...building, closedAt: new Date().toISOString() } }
    } finally {
      sky.close()
    }
  })

  router.post('/api/buildings/:id/reopen', (ctx) => {
    const sky = skyline()
    try {
      // `get` finds a boarded-up building; `list` deliberately does not, which
      // is the whole point of the column. So this route has to go by id.
      const building = buildingOr404(sky, ctx.params.id!)
      sky.reopen(building.id)
      events.emit({
        kind: 'reopened',
        building: building.id,
        detail: `${building.name} is back on the skyline.`,
      })
      return { building: { ...building, closedAt: null } }
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
          kind: asMessageKind(input.kind),
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
        allowedAuthors: config.allowedAuthors,
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
      allowedAuthors?: string[]
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
      if (input.allowedAuthors !== undefined) {
        // Discord snowflakes are digits. Anything else is a typo or a username
        // somebody pasted by mistake, and silently keeping it would leave a
        // list that looks populated and authorises nobody.
        patch.allowedAuthors = input.allowedAuthors
          .map((id) => String(id).trim())
          .filter((id) => /^\d{5,}$/.test(id))
      }

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

  /**
   * Everything waiting on the owner: dockets to decide, and finished work
   * nobody read.
   *
   * Boarded-up buildings included, deliberately. `list()` leaves them off the
   * skyline, which is right for a drawing and wrong here: boarding one up with
   * dockets pending made them un-answerable — a 404 on the one action the
   * product describes as safe and reversible.
   */
  router.get('/api/approvals', () => {
    const sky = skyline()
    try {
      const desks = sky.list({ includeClosed: true }).map((building) => {
        const store = BuildingStore.open(building.id)
        try {
          // The only place a boarded-up building is looked at, and so the only
          // place its unread work can be handed over: the home screen never
          // draws one.
          handBackUnreadWork(store, building, events)
          const where = { buildingName: building.name, boardedUp: building.closedAt !== null }
          return {
            pending: store.pendingApprovals().map((approval) =>
              docketView(approval, {
                ...where,
                /** Whether a run is actually standing there waiting for the answer. */
                waiting: desk.has(approval.id),
              })),
            /**
             * The other thing that waits on a person: work that was finished
             * and never read. It is not a docket and is not decided like one,
             * but it is on the same desk, and a screen that shows half of what
             * is waiting is how the other half gets forgotten.
             */
            unread: store.tasks({ state: 'unread' }).map((task) => ({
              ...where,
              id: task.id,
              building: building.id,
              goal: task.goal,
              summary: task.result?.summary ?? null,
              finishedAt: task.settledAt,
            })),
          }
        } finally {
          store.close()
        }
      })

      return {
        // Every kind there is, said, so a screen listing what stops at a lobby
        // desk reads it off the product rather than writing its own list —
        // which is how the commonest kind of all came to be missing from it.
        said: KIND_SAID,
        pending: desks.flatMap((one) => one.pending),
        unread: desks.flatMap((one) => one.unread),
      }
    } finally {
      sky.close()
    }
  })

  router.post('/api/approvals/:id', async (ctx) => {
    const input = await ctx.body<{ granted?: boolean }>()
    const sky = skyline()
    try {
      for (const building of sky.list({ includeClosed: true })) {
        const store = BuildingStore.open(building.id)
        try {
          const match = store.pendingApprovals().find((a) => a.id === ctx.params.id)
          if (!match) continue
          store.decide(match.id as ApprovalId, input.granted === true)
          // And let go of whoever was waiting for this. A decision that resumes
          // nothing is not a decision; when nothing was waiting — a docket left
          // by a run that has since ended — say so rather than implying it took.
          const resumed = settleAsk(match.id, input.granted === true)

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
              return { decided: true, resumed, hired: floor }
            }
          }
          events.emit({
            kind: 'decided', building: building.id,
            detail: `${input.granted ? 'Approved' : 'Refused'}: ${match.intent}`,
            data: { approval: match.id, granted: input.granted === true, resumed },
          })
          return {
            decided: true,
            resumed,
            note: resumed
              ? `${building.name} has been told, and is carrying on.`
              : 'Recorded. Nothing was waiting on this any more — the run that asked has already ended.',
          }
        } finally {
          store.close()
        }
      }
      throw notFound(`approval "${ctx.params.id}"`)
    } finally {
      sky.close()
    }
  })

  /**
   * The owner reads what nobody else could.
   *
   * The other end of `handBackUnreadWork`. A task left unread is finished work
   * with nobody to judge it, and the only judge left is the person who asked for
   * it — so there are two answers and both are honest: it holds, or it does not.
   * Accepting it is an acceptance somebody actually gave, which is the thing
   * marking it `done` behind their back would have faked.
   *
   * Sending it back settles it `escalated` — the same place a reviewer's last
   * word puts it — rather than queueing it again. A task that runs a second time
   * is the building doing work it was never asked for twice; if the owner wants
   * another go at it, that is a goal.
   */
  router.post('/api/tasks/:id/read', async (ctx) => {
    const input = await ctx.body<{ accepted?: boolean }>()
    const sky = skyline()
    try {
      for (const building of sky.list({ includeClosed: true })) {
        const store = BuildingStore.open(building.id)
        try {
          const match = store.tasks({ state: 'unread' }).find((task) => task.id === ctx.params.id)
          if (!match) continue
          const accepted = input.accepted === true
          store.setTaskState(match.id, accepted ? 'done' : 'escalated')
          events.emit({
            kind: 'work-read',
            building: building.id,
            detail: `${accepted ? 'It holds' : 'Sent back'}: ${match.goal}`,
            data: { task: match.id, accepted },
          })
          return {
            read: true,
            state: accepted ? 'done' : 'escalated',
            note: accepted
              ? 'Marked done. You read it, so it counts.'
              : 'Left as unfinished business. Put a goal to the building to have another go at it.',
          }
        } finally {
          store.close()
        }
      }
      throw notFound(`unread task "${ctx.params.id}"`)
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
      const claude = claudeExecutable()
      const recorded = new Map(sky.providers().map((record) => [record.name, record]))
      return {
        claudeCode: Boolean(claude),
        claudeCodePath: claude,
        providers: await Promise.all(
          PROVIDERS.map(async (spec) => ({
            name: spec.name, label: spec.label, note: spec.note,
            suggested: spec.suggested, needsKey: spec.needsKey,
            envVar: spec.envVar ?? null,
            /** Whether anything has been said about this one here. */
            configured: recorded.has(spec.name),
            /** Where its credential lives, for a page that must not show it. */
            credentialKind: recorded.get(spec.name)?.credentialKind ?? null,
            /**
             * An installed Claude Code reaches Anthropic on the owner's
             * subscription and wants no key at all. It is the one way to finish
             * setup without going and buying metered billing, so the page is
             * told about it rather than left to infer it from a green tick.
             */
            viaClaudeCode: spec.name === 'anthropic' && !sky.credentialFor('anthropic') && Boolean(claude),
            status: await probeProvider(spec.name, sky),
          })),
        ),
      }
    } finally {
      sky.close()
    }
  })

  /**
   * Connect a provider, from wherever the owner happens to be.
   *
   * This did not exist. `putProvider` was reachable only from the CLI, which
   * the desktop app does not ship — so the Models dialog was a read-only list
   * whose remedies were terminal commands the app never installs, under a
   * promise that there is nothing to install first.
   *
   * An environment variable is preferred over a pasted key for the same reason
   * the CLI prefers it: the secret stays out of the database, so a data
   * directory can be copied or backed up without carrying the key along.
   */
  router.post('/api/providers', async (ctx) => {
    const input = await ctx.body<{ name?: string; key?: string; env?: string; remove?: boolean }>()
    const spec = input.name ? providerSpec(input.name) : undefined
    if (!spec) {
      throw badRequest(
        input.name
          ? `No provider called "${input.name}". Known: ${PROVIDERS.map((p) => p.name).join(', ')}.`
          : 'Which provider?',
      )
    }

    const sky = skyline()
    try {
      if (input.remove === true) {
        const forgotten = sky.forgetProvider(spec.name)
        events.emit({ kind: 'provider-changed', detail: `${spec.label} disconnected.` })
        return { ok: true, forgotten, name: spec.name, status: await probeProvider(spec.name, sky) }
      }

      const key = input.key?.trim()
      const envVar = input.env?.trim()

      if (!spec.needsKey) {
        sky.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'none', credential: null })
      } else if (envVar) {
        sky.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'env', credential: envVar })
      } else if (key) {
        sky.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'literal', credential: key })
      } else if (spec.envVar && process.env[spec.envVar]) {
        // The key is already in the environment this daemon is running in.
        // Recording the variable rather than its value is the better of the two
        // and costs the owner nothing.
        sky.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'env', credential: spec.envVar })
      } else {
        throw new HttpError(
          422,
          `${spec.label} needs a key. Paste one, or name an environment variable that holds it${spec.envVar ? ` — usually ${spec.envVar}` : ''}.`,
        )
      }

      const status = await probeProvider(spec.name, sky)
      events.emit({
        kind: 'provider-changed',
        detail: status.ok ? `${spec.label} is connected.` : `${spec.label} was saved, but does not answer yet.`,
        data: { provider: spec.name, ok: status.ok },
      })
      return {
        ok: true,
        name: spec.name,
        label: spec.label,
        status,
        // Said here as well because this is the one moment the owner is looking
        // for it: a variable that is not set right now will not work yet.
        warning:
          envVar && !process.env[envVar]
            ? `${envVar} is not set in this daemon's environment, so it will not work until it is.`
            : null,
      }
    } finally {
      sky.close()
    }
  })

  /**
   * Who the owner is.
   *
   * `setOwner` existed from the first commit and nothing could reach it, so the
   * name was always empty and every message in the mailroom was from "You".
   */
  router.post('/api/owner', async (ctx) => {
    const input = await ctx.body<{ name?: string; profile?: string }>()
    if (input.name === undefined && input.profile === undefined) throw badRequest('Nothing to change.')
    const sky = skyline()
    try {
      sky.setOwner({
        ...(input.name !== undefined ? { name: input.name.trim().slice(0, 80) } : {}),
        ...(input.profile !== undefined ? { profile: input.profile.trim().slice(0, 2000) } : {}),
      })
      const owner = sky.owner()
      events.emit({ kind: 'owner-changed', detail: owner.name ? `You are ${owner.name}.` : 'Your name was cleared.' })
      return owner
    } finally {
      sky.close()
    }
  })

  /**
   * Somebody leaves, and the building gets shorter.
   *
   * Height is headcount, and until now height only ever went up: `vacate` had
   * no caller anywhere — no route, no command — so a mis-hire was permanently
   * built into the skyline. A metaphor with no way down is a trap.
   *
   * It is not a delete. The floor stays on record, their memory stays in the
   * archives, and anything they were holding comes back to the desk rather
   * than staying assigned to somebody who no longer works here.
   */
  router.post('/api/buildings/:id/floors/:floor/vacate', (ctx) => {
    const sky = skyline()
    try {
      const building = buildingOr404(sky, ctx.params.id!)
      // Not mid-goal: the run holds this floor's work open and would settle a
      // task onto somebody who left while it was being written.
      if (working.has(building.id)) {
        throw new HttpError(409, `${building.name} is working on something. Let it come back first.`)
      }
      const store = BuildingStore.open(building.id)
      try {
        const floor = store.floor(ctx.params.floor as FloorId)
        if (!floor) throw notFound(`floor "${ctx.params.floor}"`)
        if (floor.vacatedAt) return { floor, alreadyGone: true }

        const before = store.headcount()
        const { handedBack } = store.vacate(floor.id)
        const after = store.headcount()
        events.emit({
          kind: 'vacated', building: building.id, floor: floor.id,
          detail: `${floor.name} has left ${building.name}.`,
          data: {
            headcount: after, tier: tierOf(Math.max(1, after)).name,
            shrank: tierOf(Math.max(1, before)).name !== tierOf(Math.max(1, after)).name,
            handedBack,
          },
        })
        return {
          floor: { ...floor, vacatedAt: new Date().toISOString() },
          headcount: after,
          handedBack,
          // The building can still be looked at and can no longer be given a
          // goal, which is worth saying at the moment it becomes true.
          warning: store.floorByRole('manager')
            ? null
            : `${building.name} has no manager now, so it cannot be given a goal. Hire one and it can work again.`,
        }
      } finally {
        store.close()
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
