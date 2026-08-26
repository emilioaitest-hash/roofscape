import {
  SkylineStore, BuildingStore, pursueGoal, curate, tierOf, nextTierAt, renderSkyline,
  rosterFor, ROSTER, FOUNDING_ROLES, allTiers, defaultPosting, discoverProviders, describePosting, probeProvider,
  parseEvery, parseAtTime, describeSchedule,
  PROVIDERS, TOOLS_FOR_ROLE, claudeExecutable, isRepo,
  type Building, type BuildingId, type FloorRole, type ApprovalId, type FloorId,
} from '@app/core'
import { Router, HttpError, badRequest, notFound, readJson, type Ctx } from './router.js'
import type { EventStream } from './events.js'

/** One goal at a time per building. Two managers assigning at once is chaos. */
const working = new Set<string>()

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

export function buildApi(events: EventStream): Router {
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
        buildings: sky.list().map((building) => {
          const store = BuildingStore.open(building.id)
          try {
            const headcount = store.headcount()
            const tier = tierOf(Math.max(1, headcount))
            return {
              id: building.id,
              name: building.name,
              headcount,
              tier: tier.name,
              nextTierAt: nextTierAt(Math.max(1, headcount)),
              busy: store.busyFloors(),
              open: store.tasks({ state: 'queued' }).length + store.tasks({ state: 'working' }).length,
              pendingApprovals: store.pendingApprovals().length,
              working: working.has(building.id),
            }
          } finally {
            store.close()
          }
        }),
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
        return {
          ...building,
          tier: tierOf(Math.max(1, store.headcount())).name,
          staff: store.staff().map((floor) => ({
            id: floor.id, name: floor.name, role: floor.role, level: floor.level,
            posting: floor.posting, describes: describePosting(floor.posting),
          })),
          tasks: store.tasks().slice(-40),
          approvals: store.pendingApprovals(),
          archives: store.archiveStats(),
          spent: store.spentSince('1970-01-01T00:00:00.000Z'),
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
          }
        }
      } finally {
        store.close()
      }

      events.emit({ kind: 'ground-broken', building: building.id, detail: building.name })
      return building
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
      // Checked here as well as inside the run: without it the caller is told
      // the work started and then watches it fail on the stream a moment later,
      // which is a worse answer than a refusal.
      const allowance = building.budget.monthlyTokens
      const spent = allowance === null ? 0 : store.spentThisMonth()
      store.close()

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
