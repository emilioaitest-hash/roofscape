import { createInterface } from 'node:readline/promises'
import { pursueGoal, type EscalationKind } from '@app/core'
import { openSkyline, openBuilding, findBuilding } from '../context.js'
import { say, dim, bold, tick, note, fail, heading, amber, green, red, ago } from '../ui.js'

/** Put a goal to a building and watch it work. */
export async function goal(text: string | undefined, options: { building?: string; yes?: boolean }): Promise<void> {
  if (!text) fail('What do you want done?', 'roofscape goal "Add a results page to the site"')

  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)

  if (store.headcount() === 0) {
    fail(`${building.name} has nobody in it.`, `Hire a manager:  roofscape hire manager --building ${building.id}`)
  }

  say()
  say(bold(`${building.name}`))
  say(dim(`  "${text}"`))
  say()

  const outcome = await pursueGoal(
    {
      building,
      store,
      credentials: skyline,
      ask: askOwner(store, options.yes ?? false),
      report: (line) => say(dim(`  ${line}`)),
      onEvent: (floor, event) => {
        if (event.kind === 'tool') process.stdout.write(dim('.'))
        if (event.kind === 'stopped') say(`\n  ${amber(`${floor.name}: ${event.detail}`)}`)
      },
    },
    text,
  )

  say('\n')
  heading('What happened')
  say(`  ${outcome.managerSummary}`)

  if (outcome.worked.length > 0) {
    heading('Work done')
    for (const item of outcome.worked) {
      const mark = item.succeeded ? green('✓') : red('✗')
      say(`  ${mark} ${bold(item.floor.name)} — ${item.task.goal.slice(0, 70)}`)
      say(dim(`      ${item.summary.slice(0, 160)}`))
      if (item.branch) say(dim(`      branch: ${item.branch}`))
      if (item.review) {
        const mark = item.review.accepted ? green('accepted') : amber('sent back')
        say(dim(`      ${mark} by ${item.review.by}: ${item.review.verdict.slice(0, 120)}`))
      }
    }
  }

  if (outcome.outstanding > 0) note(`${outcome.outstanding} task(s) still queued — run the goal again to continue.`)
  say()
  say(dim(`  ${outcome.tokensSpent.toLocaleString()} output tokens spent.`))
  say()

  store.close()
  skyline.close()
}

/**
 * How an agent reaches the owner mid-task.
 *
 * At a terminal this asks. Unattended it records the request and refuses, which
 * is the safe default: an approval that assumes yes is not an approval.
 */
function askOwner(store: ReturnType<typeof openBuilding>, autoYes: boolean) {
  return async (kind: EscalationKind, intent: string): Promise<boolean> => {
    const manager = store.floorByRole('manager')
    if (manager) store.requestApproval({ kind: kind as 'publish', by: manager.id, intent })

    if (autoYes) {
      say(`\n  ${amber('→')} ${intent} ${dim('(approved by --yes)')}`)
      return true
    }
    if (!process.stdin.isTTY) {
      say(`\n  ${amber('→')} ${intent} ${dim('(nobody here to ask — refused, and left at the desk)')}`)
      return false
    }

    say()
    say(`  ${amber('The building is asking:')} ${intent}`)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = (await rl.question(dim('  Allow it? [y/N] '))).trim().toLowerCase()
      return answer === 'y' || answer === 'yes'
    } finally {
      rl.close()
    }
  }
}

/** The approval desk: everything waiting on you, across every building. */
export function lobby(): void {
  const skyline = openSkyline()
  const buildings = skyline.list()
  let total = 0

  for (const building of buildings) {
    const store = openBuilding(building.id)
    const pending = store.pendingApprovals()
    if (pending.length > 0) {
      heading(building.name)
      for (const approval of pending) {
        say(`  ${dim(approval.id)}  ${dim(`[${approval.kind}]`)} ${approval.intent}`)
        say(dim(`      asked ${ago(approval.createdAt)}`))
      }
      total += pending.length
    }
    store.close()
  }

  say()
  if (total === 0) {
    tick('Nothing waiting on you.')
  } else {
    say(dim(`  ${total} waiting. Decide with:  roofscape approve <id>   or   roofscape refuse <id>`))
  }
  say()
  skyline.close()
}

export function decide(id: string | undefined, granted: boolean): void {
  if (!id) fail('Which one?', 'roofscape lobby  — to see what is waiting')
  const skyline = openSkyline()
  for (const building of skyline.list()) {
    const store = openBuilding(building.id)
    const match = store.pendingApprovals().find((a) => a.id === id || a.id.startsWith(id))
    if (match) {
      store.decide(match.id, granted)
      tick(`${granted ? 'Approved' : 'Refused'}: ${match.intent}`)
      store.close()
      skyline.close()
      return
    }
    store.close()
  }
  skyline.close()
  fail(`Nothing pending with id "${id}".`)
}
