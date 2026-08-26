import { SkylineStore, BuildingStore, describeSchedule } from '@app/core'
import { startGoal, isWorking } from './api.js'
import type { EventStream } from './events.js'

/**
 * The thing that makes a building work while nobody is watching.
 *
 * Checked often and cheaply: a query against one small indexed table, so the
 * cost of asking is near nothing and a machine that was asleep catches up the
 * moment it wakes.
 */
export function startTicker(events: EventStream, everyMs = 30_000): () => void {
  let running = false

  const tick = () => {
    // Two ticks overlapping would start the same order twice. A skipped tick
    // costs thirty seconds; a doubled one costs a duplicate goal.
    if (running) return
    running = true
    try {
      run(events)
    } catch (error) {
      events.emit({ kind: 'ticker-failed', detail: (error as Error).message })
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, everyMs)
  timer.unref()
  // A little after startup, so a daemon restarted at the wrong moment still
  // picks up what it missed rather than waiting a whole period.
  setTimeout(tick, 3000).unref()

  return () => clearInterval(timer)
}

function run(events: EventStream): void {
  const sky = SkylineStore.open()
  try {
    const due = sky.dueSchedules()
    if (due.length === 0) return

    for (const order of due) {
      const building = sky.get(order.building)
      if (!building || building.closedAt !== null) {
        // The building is gone or mothballed; the order outlived it.
        sky.unschedule(order.id)
        continue
      }

      if (isWorking(building.id)) {
        // Leave it due. It will be picked up on a later tick rather than
        // queueing behind work that is already running.
        continue
      }

      const store = BuildingStore.open(building.id)
      const staffed = store.headcount() > 0
      store.close()
      if (!staffed) {
        events.emit({
          kind: 'schedule-skipped', building: building.id,
          detail: `${building.name} has nobody in it, so "${order.goal}" did not run.`,
        })
        sky.markScheduleRan(order.id)
        continue
      }

      events.emit({
        kind: 'schedule-due', building: building.id,
        detail: `${describeSchedule(order)}: ${order.goal}`,
      })
      sky.markScheduleRan(order.id)
      startGoal(events, building, order.goal, { source: 'schedule' })
    }
  } finally {
    sky.close()
  }
}
