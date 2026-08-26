import { runFloorTurn } from './run.js'
import { Workspace } from '../tools/workspace.js'
import { rosterFor } from '../staff/roster.js'
import { TOOLS_FOR_ROLE } from '../tools/definitions.js'
import { defaultPosting } from '../providers/roles.js'
import type { BuildingStore } from '../store/buildingStore.js'
import type { Credentials } from '../providers/resolve.js'
import type { Building } from '../domain/building.js'

export interface CurateResult {
  before: number
  after: number
  summary: string
  tokensSpent: number
}

/**
 * Send the curator down to the archives.
 *
 * This is the mechanism that is supposed to make memory get better rather than
 * merely bigger: duplicates merged, repeated episodes promoted into stated
 * facts, the stale expired. It runs on whatever model is cheapest, because it is
 * the largest volume of work in the building and the least interesting.
 */
export async function curate(
  deps: { building: Building; store: BuildingStore; credentials: Credentials; available: readonly string[] },
  options: { batch?: number } = {},
): Promise<CurateResult> {
  const { building, store, credentials, available } = deps

  let curator = store.floorByRole('curator')
  if (!curator) {
    const entry = rosterFor('curator')!
    const posting = defaultPosting('curator', available)
    if (!posting) throw new Error('No provider is set up that can run a curator.')
    curator = store.hire({
      role: 'curator',
      name: entry.suggestedName,
      charter: entry.charter,
      posting,
      tools: TOOLS_FOR_ROLE.curator ?? [],
    })
  }

  const before = store.memoryCount()
  const stats = store.archiveStats()
  const spentBefore = store.spentSince('1970-01-01T00:00:00.000Z')

  const turn = await runFloorTurn({
    building,
    store,
    credentials,
    floor: curator,
    task: null,
    instruction: [
      'Go through the archives and leave them better than you found them.',
      '',
      `There are ${stats.total} notes: ${Object.entries(stats.byLayer).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}.`,
      `${stats.pinned} are pinned. ${stats.expired} have already expired.`,
      '',
      `Read a batch with list_memory (up to ${options.batch ?? 40}), then:`,
      '  · merge notes that say the same thing — write the merged one, forget the rest',
      '  · promote anything that keeps recurring in episodes into a plain semantic fact',
      '  · expire what is no longer true, and say what replaced it',
      '  · forget notes about work nobody does any more',
      '  · pin only what would be a disaster to miss, and unpin anything that would not',
      '',
      'Where two notes contradict, keep both and write a third saying they conflict.',
      'You do not get to decide which is true.',
      '',
      'Finish with a plain count of what you merged, promoted, expired and forgot.',
    ].join('\n'),
    workspace: new Workspace(building.workspace),
    cwd: building.workspace,
    ask: async () => false,
  })

  return {
    before,
    after: store.memoryCount(),
    summary: turn.finished?.summary ?? turn.note,
    tokensSpent: store.spentSince('1970-01-01T00:00:00.000Z') - spentBefore,
  }
}
