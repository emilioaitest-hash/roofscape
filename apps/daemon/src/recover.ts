import { SkylineStore, BuildingStore } from '@app/core'
import type { EventStream } from './events.js'

/**
 * Put right what a sudden stop left behind.
 *
 * A task is marked `working` while a floor is on it, and nothing un-marks it if
 * the process dies — a crash, a laptop lid, a deploy. Those tasks would sit in
 * `working` for ever: never picked up again, never reported, and counted as
 * busy on the skyline, so the building looks permanently mid-job.
 *
 * They go back to `queued`, because the work was asked for and was not done.
 *
 * It also lets through work that was left waiting for a reader who does not
 * exist — see `settleUnreadable`, which is about an installation that ran the
 * old code rather than about a crash.
 */
export function recoverInterruptedWork(events?: EventStream): number {
  const sky = SkylineStore.open()
  let recovered = 0
  try {
    for (const building of sky.list({ includeClosed: true })) {
      const store = BuildingStore.open(building.id)
      try {
        recovered += settleUnreadable(store, building.name, events, building.id)
        const stranded = store.tasks({ state: 'working' })
        for (const task of stranded) {
          store.setTaskState(task.id, 'queued')
          recovered += 1
        }
        if (stranded.length > 0) {
          // The whole clause has to agree, not just the noun: pluralising
          // "task" alone produced "1 task were interrupted and have been put
          // back", which is the first thing anybody reads after a crash.
          events?.emit({
            kind: 'recovered',
            building: building.id,
            detail:
              stranded.length === 1
                ? 'One task was interrupted and is back in the queue.'
                : `${stranded.length} tasks were interrupted and are back in the queue.`,
          })
        }
      } finally {
        store.close()
      }
    }
  } finally {
    sky.close()
  }
  return recovered
}

/**
 * Finished work that has been waiting for a reader who does not exist.
 *
 * Nothing in the product ever reached `done` unless the building had a
 * reviewer, and a building is founded with a manager and a coder. So every
 * success an installation ever had is sitting in `awaiting-review`: counted as
 * open, lighting a window, and unable to move — there is nobody to read it and
 * nothing that would ask them again.
 *
 * The orchestrator no longer creates this state. This is for the buildings that
 * are already in it, and it says so on the stream rather than quietly tidying
 * up behind the owner's back.
 */
function settleUnreadable(
  store: BuildingStore,
  name: string,
  events: EventStream | undefined,
  buildingId: string,
): number {
  if (store.floorByRole('reviewer')) return 0
  const waiting = store.tasks({ state: 'awaiting-review' })
  for (const task of waiting) store.setTaskState(task.id, 'done')
  if (waiting.length > 0) {
    events?.emit({
      kind: 'settled',
      building: buildingId,
      detail:
        waiting.length === 1
          ? `One finished task at ${name} was waiting to be read by nobody, so it has gone through.`
          : `${waiting.length} finished tasks at ${name} were waiting to be read by nobody, so they have gone through.`,
      data: { settled: waiting.length, remedy: 'Hire a reviewer and finished work is read before it counts.' },
    })
  }
  return waiting.length
}
