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
 * Anything already awaiting review is left alone: that work exists.
 */
export function recoverInterruptedWork(events?: EventStream): number {
  const sky = SkylineStore.open()
  let recovered = 0
  try {
    for (const building of sky.list()) {
      const store = BuildingStore.open(building.id)
      try {
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
