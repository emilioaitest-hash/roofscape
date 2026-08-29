import { createInterface } from 'node:readline/promises'
import {
  pursueGoal, rosterFor, defaultPosting, availableProviders, TOOLS_FOR_ROLE, tierOf,
  saidKind, commandIn,
  type EscalationKind, type FloorRole,
} from '@app/core'
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

  // The one line that has to be true. A goal that never reached a model used to
  // arrive here indistinguishable from one that worked, because the runtime
  // reports a provider failure rather than raising it.
  const mark = outcome.verdict === 'did-something' ? green('✓') : outcome.verdict === 'did-nothing' ? amber('·') : red('✗')
  say(`${mark} ${bold(outcome.headline)}`)
  say(dim(`  ${outcome.why}`))
  if (outcome.remedy) say(dim(`  ${outcome.remedy}`))

  if (outcome.verdict !== 'could-not-start') {
    heading('What the manager said')
    say(`  ${outcome.managerSummary}`)
  }

  if (outcome.worked.length > 0) {
    heading('Work done')
    for (const item of outcome.worked) {
      const mark = item.settled === 'done' ? green('✓') : item.succeeded ? amber('·') : red('✗')
      say(`  ${mark} ${bold(item.floor.name)} — ${item.task.goal.slice(0, 70)}`)
      say(dim(`      ${item.summary.slice(0, 160)}`))
      if (item.branch) say(dim(`      branch: ${item.branch}`))
      if (item.review) {
        const mark = item.review.accepted ? green('accepted') : amber('not accepted')
        const again = item.reworks > 0 ? ` after ${item.reworks} rework${item.reworks === 1 ? '' : 's'}` : ''
        say(dim(`      ${mark}${again} by ${item.review.by}: ${item.review.verdict.slice(0, 110)}`))
      } else if (item.settled === 'done') {
        say(dim('      nobody here read it, so it went straight through'))
      }
    }
  }

  if (outcome.outstanding > 0) note(`${outcome.outstanding} task(s) still queued — run the goal again to continue.`)
  say()
  say(dim(`  ${outcome.tokensSpent.toLocaleString()} output tokens spent.`))
  say()

  store.close()
  skyline.close()

  // A goal that could not start is a failed command, and a shell has every
  // right to know that: this runs in scripts and standing orders.
  if (outcome.verdict === 'could-not-start') process.exitCode = 1
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
    if (manager) store.requestApproval({ kind, by: manager.id, intent })

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

/**
 * The approval desk: everything waiting on you, across every building.
 *
 * Boarded-up ones included. They are off the skyline, which is right for a
 * drawing and wrong here: a docket in a building you have boarded up was
 * un-answerable, for the one action the product calls safe and reversible.
 *
 * Two kinds of thing wait on a person, so both are here. A docket is a request
 * to do something; unread work is something already done that nobody in the
 * building can judge, because the run that would have read it ended. Sending
 * somebody to two screens to find out what is waiting on them is how one of the
 * two gets forgotten.
 */
export function lobby(): void {
  const skyline = openSkyline()
  const buildings = skyline.list({ includeClosed: true })
  let total = 0

  for (const building of buildings) {
    const store = openBuilding(building.id)
    const pending = store.pendingApprovals()
    const unread = store.tasks({ state: 'unread' })
    if (pending.length + unread.length > 0) {
      heading(building.closedAt ? `${building.name} (boarded up)` : building.name)
      for (const approval of pending) {
        // The kind said rather than printed, and for a command the command
        // itself: `[shell] Run: git push --force` is three words of scaffolding
        // around the only part that decides the answer.
        say(`  ${dim(approval.id)}  ${amber(saidKind(approval.kind))}`)
        say(`      ${commandIn(approval) ?? approval.intent}`)
        say(dim(`      asked ${ago(approval.createdAt)}`))
      }
      for (const task of unread) {
        say(`  ${dim(task.id)}  ${amber('finished, and nobody read it')}`)
        say(`      ${task.goal}`)
        if (task.result) say(dim(`      ${task.result.summary.slice(0, 160)}`))
        if (task.settledAt) say(dim(`      finished ${ago(task.settledAt)}`))
      }
      total += pending.length + unread.length
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

/**
 * Decide one thing that is waiting on you. Granting it does the thing rather
 * than merely recording that you said yes — an approval nobody acts on is a
 * note, not a decision.
 *
 * Two things can be waiting, and the same two words answer both: a docket, and
 * a piece of finished work nobody read. The id says which, so the owner does
 * not have to.
 */
export function decide(id: string | undefined, granted: boolean): void {
  if (!id) fail('Which one?', 'roofscape lobby  — to see what is waiting')
  const skyline = openSkyline()

  for (const building of skyline.list({ includeClosed: true })) {
    const store = openBuilding(building.id)
    const match = store.pendingApprovals().find((a) => a.id === id || a.id.startsWith(id))
    if (!match) {
      store.close()
      continue
    }

    store.decide(match.id, granted)
    if (!granted) {
      tick(`Refused: ${match.intent}`)
      store.close(); skyline.close()
      return
    }

    if (match.payload?.do === 'hire') {
      const entry = rosterFor(match.payload.role as FloorRole)
      const posting = entry ? defaultPosting(entry.role, availableProviders(skyline)) : null
      if (!entry || !posting) {
        say()
        say(amber(`Approved, but the hire could not be made: no provider suits a ${match.payload.role}.`))
        say(dim('  Add one, then:  roofscape hire ' + match.payload.role))
        store.close(); skyline.close()
        return
      }
      const before = store.headcount()
      const floor = store.hire({
        role: entry.role,
        name: match.payload.name || entry.suggestedName,
        charter: match.payload.charter || entry.charter,
        posting,
        tools: TOOLS_FOR_ROLE[entry.role] ?? [],
      })
      const after = store.headcount()
      tick(`${floor.name} joins ${building.name} as ${entry.role} — floor ${after}`)
      const grew = tierOf(before).name !== tierOf(after).name
      if (grew) say(dim(`  ${building.name} is now a ${tierOf(after).name}.`))
    } else {
      tick(`Approved: ${match.intent}`)
    }

    store.close(); skyline.close()
    return
  }

  // No docket by that id, so it may be work waiting to be read. Accepting it is
  // an acceptance somebody actually gave, which is the thing nobody could give
  // it inside the building; sending it back leaves it as unfinished business,
  // exactly where a reviewer's last word would have left it.
  for (const building of skyline.list({ includeClosed: true })) {
    const store = openBuilding(building.id)
    const task = store.tasks({ state: 'unread' }).find((t) => t.id === id || t.id.startsWith(id))
    if (!task) {
      store.close()
      continue
    }

    store.setTaskState(task.id, granted ? 'done' : 'escalated')
    if (granted) {
      tick(`Read and accepted: ${task.goal}`)
      say(dim('  You read it, so it counts.'))
    } else {
      tick(`Sent back: ${task.goal}`)
      say(dim(`  Left as unfinished business. Put a goal to ${building.name} to have another go at it.`))
    }
    store.close(); skyline.close()
    return
  }

  skyline.close()
  fail(`Nothing waiting on you with id "${id}".`)
}
