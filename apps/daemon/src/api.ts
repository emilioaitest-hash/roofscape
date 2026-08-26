import {
  SkylineStore, BuildingStore, pursueGoal, curate, tierOf, nextTierAt,
  rosterFor, defaultPosting, discoverProviders, describePosting, probeProvider,
  PROVIDERS, TOOLS_FOR_ROLE, claudeExecutable, isRepo,
  type Building, type BuildingId, type FloorRole, type ApprovalId, type FloorId,
} from '@app/core'
import { Router, HttpError, badRequest, notFound, readJson, type Ctx } from './router.js'
import type { EventStream } from './events.js'

/** One goal at a time per building. Two managers assigning at once is chaos. */
const working = new Set<string>()

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
        const available = await discoverProviders(sky)
        for (const role of ['manager', 'hiring'] as const) {
          const entry = rosterFor(role)!
          const posting = defaultPosting(role, available)
          if (posting) {
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
    const building = buildingOr404(sky, ctx.params.id!)
    if (working.has(building.id)) {
      sky.close()
      throw new HttpError(409, `${building.name} is already working on something.`)
    }

    const store = BuildingStore.open(building.id)
    if (store.headcount() === 0) {
      store.close(); sky.close()
      throw new HttpError(422, `${building.name} has nobody in it yet.`)
    }

    working.add(building.id)
    events.emit({ kind: 'goal-started', building: building.id, detail: input.goal })

    // Deliberately not awaited: a goal takes minutes, and an HTTP request that
    // hangs for minutes is one a proxy or a laptop lid will kill halfway. The
    // caller watches /api/events instead.
    void pursueGoal(
      {
        building, store, credentials: sky,
        ask: async (kind, intent) => {
          const manager = store.floorByRole('manager')
          if (manager) store.requestApproval({ kind: kind as 'publish', by: manager.id, intent })
          events.emit({ kind: 'asked', building: building.id, detail: intent })
          return input.approveEverything === true
        },
        report: (line) => events.emit({ kind: 'progress', building: building.id, detail: line }),
        onEvent: (floor, event) =>
          events.emit({ kind: event.kind, building: building.id, floor: floor.id, detail: event.detail }),
      },
      input.goal,
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

    return { started: true, building: building.id, watch: '/api/events' }
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
