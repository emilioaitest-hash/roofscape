import { z } from 'zod'
import { SkylineStore } from '../store/skylineStore.js'
import { BuildingStore } from '../store/buildingStore.js'
import { tierOf } from '../skyline/tiers.js'
import { describePosting } from '../providers/roles.js'
import type { BuildingId } from '../domain/ids.js'

/**
 * What the concierge can do.
 *
 * Deliberately not a building's tool row. The concierge reads across the whole
 * skyline and writes nothing: it can look into any building and hand work to
 * one, and it cannot edit a file, run a command or hire anybody. Somebody who
 * can see everything should be able to change very little.
 */
export interface LobbyTool {
  name: string
  description: string
  shape: Record<string, z.ZodTypeAny>
  run: (input: Record<string, unknown>) => Promise<unknown>
}

export interface LobbyDeps {
  /** Starts a goal on a building. Returns what to tell the owner. */
  startGoal: (building: BuildingId, goal: string) => Promise<string>
}

export function lobbyTools(deps: LobbyDeps): LobbyTool[] {
  const withSkyline = <T>(work: (sky: SkylineStore) => T): T => {
    const sky = SkylineStore.open()
    try {
      return work(sky)
    } finally {
      sky.close()
    }
  }

  const withBuilding = <T>(id: string, work: (store: BuildingStore, sky: SkylineStore) => T): T | { error: string } =>
    withSkyline((sky) => {
      const building = sky.get(id as BuildingId) ?? sky.byName(id)
      if (!building) return { error: `No building called "${id}".` }
      const store = BuildingStore.open(building.id)
      try {
        return work(store, sky)
      } finally {
        store.close()
      }
    })

  return [
    {
      name: 'list_buildings',
      description:
        'Every building, how big it is, and what it is for. Start here. `floors` is how tall a ' +
        'building is and `staff` is how many people are in it; they differ when somebody works ' +
        'below ground, because the archives are not a storey.',
      shape: {},
      run: async () =>
        withSkyline((sky) => ({
          buildings: sky.list().map((building) => {
            const store = BuildingStore.open(building.id)
            try {
              return {
                id: building.id,
                name: building.name,
                charter: building.charter.slice(0, 300),
                // These were one field called `staff`, holding the floor count
                // — which excludes the curator, because tidying up is not
                // growth. `look_into` then listed everybody, so the two tools
                // disagreed about the same building by one, and a concierge
                // reading both said so and could not tell which was right.
                floors: store.headcount(),
                staff: store.staff().length,
                form: tierOf(Math.max(1, store.headcount())).name,
                inHand: store.tasks({ state: 'queued' }).length + store.tasks({ state: 'working' }).length,
                waitingOnOwner: store.pendingApprovals().length,
                busy: store.claimHolder() !== null,
              }
            } finally {
              store.close()
            }
          }),
        })),
    },
    {
      name: 'look_into',
      description: 'One building in detail: who works there, what is in hand, what was recently finished.',
      shape: { building: z.string() },
      run: async (input) =>
        withBuilding(input.building as string, (store) => ({
          floors: store.headcount(),
          staff: store.staff().map((f) => ({
            name: f.name,
            role: f.role,
            running: describePosting(f.posting),
            // Says outright why the roster can be longer than the building is
            // tall, rather than leaving a reader to reconcile two numbers.
            worksBelowGround: f.role === 'curator',
          })),
          inHand: store.tasks({ state: 'queued' }).concat(store.tasks({ state: 'working' }))
            .map((t) => ({ goal: t.goal.slice(0, 120), state: t.state })),
          recentlyFinished: store.tasks({ state: 'done' }).slice(-5)
            .map((t) => ({ goal: t.goal.slice(0, 120), result: t.result?.summary?.slice(0, 200) ?? '' })),
          waitingOnOwner: store.pendingApprovals().map((a) => ({ id: a.id, intent: a.intent })),
          spentThisMonth: store.spentThisMonth(),
          notes: store.memoryCount(),
        })),
    },
    {
      name: 'recall_in',
      description: 'Search one building\'s archives. Use it before guessing at how that building does something.',
      shape: { building: z.string(), query: z.string() },
      run: async (input) =>
        withBuilding(input.building as string, (store) => ({
          found: store.recallByKeyword(input.query as string, { limit: 8 })
            .map((m) => ({ layer: m.layer, text: m.text })),
        })),
    },
    {
      name: 'hand_to',
      description:
        'Give a building a goal. Say it the way you would to the manager there — they cannot ask you what you meant. Only do this when the owner has asked for work to be done, not to satisfy your own curiosity.',
      shape: { building: z.string(), goal: z.string() },
      run: async (input) => {
        const found = withSkyline((sky) => sky.get(input.building as BuildingId) ?? sky.byName(input.building as string))
        if (!found) return { error: `No building called "${input.building}".` }
        return { handed: await deps.startGoal(found.id, input.goal as string) }
      },
    },
    {
      name: 'answer',
      description: 'Give the owner your answer and stop. Call this exactly once, at the end.',
      shape: { text: z.string().describe('The answer, in plain language.') },
      run: async (input) => ({ answered: input.text }),
    },
  ]
}
