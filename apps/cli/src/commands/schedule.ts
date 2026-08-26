import { parseEvery, parseAtTime, describeSchedule } from '@app/core'
import { openSkyline, findBuilding } from '../context.js'
import { say, dim, bold, tick, note, fail, heading, green, ago } from '../ui.js'

/** Put a goal on a repeating footing. */
export function schedule(
  goal: string | undefined,
  options: { building?: string; every?: string; at?: string },
): void {
  if (!goal) {
    fail(
      'What should it do, and how often?',
      'roofscape schedule "Check the build" --every daily --at 09:00',
    )
  }

  const everyMinutes = parseEvery(options.every ?? 'daily')
  if (everyMinutes === null) {
    fail(
      `"${options.every}" is not an interval I can read.`,
      'Try: 30m, 4h, daily, weekly — or 2 days.',
    )
  }
  if (options.at !== undefined && parseAtTime(options.at) === null) {
    fail(`"${options.at}" is not a time of day.`, 'Try: 09:00')
  }

  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const order = skyline.schedule({
    building: building.id,
    goal,
    everyMinutes,
    atTime: options.at ?? null,
  })

  say()
  tick(`${bold(building.name)} will do this ${describeSchedule(order)}.`)
  say(dim(`  "${goal}"`))
  note(`First run ${when(order.nextRunAt)}.  ${dim(order.id)}`)
  note('It runs only while the service is up:  roofscape serve')
  say()
  skyline.close()
}

/** Everything on a repeating footing, across every building. */
export function schedules(): void {
  const skyline = openSkyline()
  const orders = skyline.schedules()
  const names = new Map(skyline.list({ includeClosed: true }).map((b) => [b.id as string, b.name]))

  if (orders.length === 0) {
    say()
    note('Nothing on a standing order.')
    say(dim('  roofscape schedule "Check the build" --every daily --at 09:00'))
    say()
    skyline.close()
    return
  }

  heading(`Standing orders (${orders.length})`)
  for (const order of orders) {
    const state = order.enabled ? green('on') : dim('paused')
    say(`  ${state}  ${bold(names.get(order.building) ?? order.building)}  ${dim(describeSchedule(order))}`)
    say(`      ${order.goal.slice(0, 70)}`)
    say(dim(`      next ${when(order.nextRunAt)}${order.lastRunAt ? ` · last ran ${ago(order.lastRunAt)}` : ''}  ${order.id}`))
  }
  say()
  say(dim('  Pause or drop one:  roofscape unschedule <id> [--pause]'))
  say()
  skyline.close()
}

export function unschedule(id: string | undefined, options: { pause?: boolean }): void {
  if (!id) fail('Which standing order?', 'roofscape schedules  — to see them')
  const skyline = openSkyline()
  const found = skyline.schedules().find((s) => s.id === id || s.id.startsWith(id))
  if (!found) {
    skyline.close()
    fail(`No standing order with id "${id}".`)
  }

  if (options.pause) {
    skyline.setScheduleEnabled(found.id, !found.enabled)
    tick(found.enabled ? 'Paused. It keeps its place and can be started again.' : 'Started again.')
  } else {
    skyline.unschedule(found.id)
    tick('Dropped.')
  }
  skyline.close()
}

/** Relative, forwards. "in 4 hours" is easier to judge than a timestamp. */
function when(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  if (seconds < 0) return 'now'
  if (seconds < 90) return 'in under a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `in ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  return `in ${Math.round(hours / 24)} days`
}
