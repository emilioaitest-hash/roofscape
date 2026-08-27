import { renderSkyline, tierOf, nextTierAt, floorsSaid, type BuildingView } from '@app/core'
import { openSkyline, openBuilding, findBuilding } from '../context.js'
import { say, dim, bold, colour, heading, amber } from '../ui.js'

/** The home screen: every building, at its true height. */
export function showSkyline(): void {
  const skyline = openSkyline()
  const buildings = skyline.list()

  if (buildings.length === 0) {
    say()
    say(renderSkyline([], { colour }))
    say()
    say(dim('  Nothing built yet. Break ground on your first project:'))
    say(`      ${bold('roofscape ground "My Project" --workspace ~/code/my-project')}`)
    say()
    skyline.close()
    return
  }

  let waiting = 0
  const views: BuildingView[] = buildings.map((building) => {
    const store = openBuilding(building.id)
    const headcount = store.headcount()
    const busy = store.busyFloors()
    const open = store.tasks({ state: 'queued' }).length + store.tasks({ state: 'working' }).length
    const pending = store.pendingApprovals().length
    waiting += pending
    store.close()
    return {
      name: building.name,
      headcount: Math.max(1, headcount),
      working: busy,
      // What is stalled matters more than what is busy: work waiting on you is
      // work not happening, and it should not have to be gone looking for.
      note: pending > 0 ? `${pending} for you` : open > 0 ? `${open} in hand` : floorsSaid(headcount),
    }
  })

  say()
  say(renderSkyline(views, { colour }))
  say()

  for (const [index, building] of buildings.entries()) {
    const view = views[index]!
    const tier = tierOf(view.headcount)
    const next = nextTierAt(view.headcount)
    const toGo = next === null ? '' : dim(`  · ${next - view.headcount} more to a ${tierOf(next).name}`)
    say(`  ${bold(building.name)} ${dim(`(${building.id})`)} — ${tier.name}${toGo}`)
  }
  say()
  if (waiting > 0) {
    say(`  ${amber(`${waiting} thing${waiting === 1 ? '' : 's'} waiting on you`)} ${dim('— roofscape lobby')}`)
    say()
  }
  skyline.close()
}

/** One building, in detail. */
export function showBuilding(id: string | undefined): void {
  const skyline = openSkyline()
  const building = findBuilding(skyline, id)
  const store = openBuilding(building.id)

  const staff = store.staff()
  const headcount = Math.max(1, staff.length)
  const tier = tierOf(headcount)

  say()
  const drawn = renderSkyline([{ name: building.name, headcount, working: store.busyFloors(), note: tier.name }], { colour })
  say(drawn)
  say()
  say(dim(`  ${tier.blurb}`))
  say()

  heading('Charter')
  say(`  ${building.charter}`)

  heading(`Staff (${staff.length})`)
  if (staff.length === 0) {
    say(dim('  Nobody yet. Hire a manager:  roofscape hire manager'))
  } else {
    for (const floor of staff) {
      say(`  ${bold(floor.name.padEnd(10))} ${dim(floor.role.padEnd(11))} ${dim(floor.id)}`)
    }
  }

  const open = [...store.tasks({ state: 'queued' }), ...store.tasks({ state: 'working' }), ...store.tasks({ state: 'awaiting-review' })]
  heading(`Work in hand (${open.length})`)
  if (open.length === 0) {
    say(dim('  Nothing on. Give it a goal:  roofscape goal "..."'))
  } else {
    for (const task of open) {
      const who = store.floor(task.assignedTo)?.name ?? '?'
      say(`  ${dim(task.state.padEnd(16))} ${who.padEnd(10)} ${task.goal.slice(0, 60)}`)
    }
  }

  // Finished work leaves a branch behind. Without this it is produced and then
  // invisible, and the owner has to know to go and look in git for it.
  const settled = [...store.tasks({ state: 'done' }), ...store.tasks({ state: 'awaiting-review' })]
    .sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''))
    .slice(0, 6)
  if (settled.length > 0) {
    heading(`Recently finished (${settled.length})`)
    for (const task of settled) {
      const who = store.floor(task.assignedTo)?.name ?? '?'
      const branch = task.result?.artifacts.find((a) => a.startsWith('branch:'))?.slice(7)
      say(`  ${bold(who.padEnd(10))} ${task.goal.slice(0, 56)}`)
      if (branch) say(dim(`      ${branch}   ${dim(`git merge ${branch}`)}`))
      else if (task.result) say(dim(`      ${task.result.summary.slice(0, 70)}`))
    }
    const branches = settled.filter((t) => t.result?.artifacts.some((a) => a.startsWith('branch:')))
    if (branches.length > 0) {
      say(dim(`\n  Read one before merging:  git diff main..<branch>`))
    }
  }

  const pending = store.pendingApprovals()
  if (pending.length > 0) {
    heading(`Waiting for you (${pending.length})`)
    for (const approval of pending) say(`  ${dim(approval.id)}  ${approval.intent.slice(0, 70)}`)
    say(dim('\n  Decide with:  roofscape approve <id>   or   roofscape refuse <id>'))
  }

  heading('Archives')
  say(dim(`  ${store.memoryCount().toLocaleString()} notes · ${store.spentSince('1970-01-01T00:00:00.000Z').toLocaleString()} output tokens spent all told`))
  say()

  store.close()
  skyline.close()
}
