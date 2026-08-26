import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runFloorTurn, asTaskResult, type TurnEvent, type TurnRequest } from './run.js'
import { Workspace } from '../tools/workspace.js'
import { openWorktree, closeWorktree, summariseWork, commitAll, isRepo, fullDiff } from '../tools/git.js'
import type { BuildingStore } from '../store/buildingStore.js'
import type { Credentials } from '../providers/resolve.js'
import type { Building, Floor } from '../domain/building.js'
import type { Task } from '../domain/work.js'
import type { EscalationKind } from '../tools/context.js'

/** Thrown when somebody else already has the building. */
export class BuildingBusyError extends Error {
  constructor(readonly building: string, readonly heldBy: string) {
    super(`${building} is already being worked on by ${heldBy}. Wait for it to finish, or look at: roofscape building`)
    this.name = 'BuildingBusyError'
  }
}

export interface OrchestrationDeps {
  building: Building
  store: BuildingStore
  credentials: Credentials
  ask: (kind: EscalationKind, intent: string) => Promise<boolean>
  report: (line: string) => void
  onEvent?: (floor: Floor, event: TurnEvent) => void
  /** See TurnRequest.resolveModel. Passed through to every turn. */
  resolveModel?: TurnRequest['resolveModel']
  /** Who is asking, for the claim. Defaults to this process. */
  holder?: string
}

export interface GoalOutcome {
  managerSummary: string
  worked: Array<{
    task: Task
    floor: Floor
    summary: string
    succeeded: boolean
    branch: string | null
    review: Review | null
    /** How many times it went back. Zero means it was right first time. */
    reworks: number
  }>
  outstanding: number
  tokensSpent: number
}

/** Thrown rather than reported, because there is nothing to report on. */
export class BudgetReachedError extends Error {
  constructor(
    readonly building: string,
    readonly spent: number,
    readonly allowance: number,
  ) {
    super(
      `${building} has spent ${spent.toLocaleString()} of its ${allowance.toLocaleString()} output tokens this month. ` +
        'Raise the allowance to carry on: roofscape budget --monthly <n>',
    )
    this.name = 'BudgetReachedError'
  }
}

export interface Review {
  by: string
  accepted: boolean
  verdict: string
}

/**
 * Put a goal to the building and let it work.
 *
 * The manager decides what the tasks are; every task then runs as its assignee,
 * in its own worktree if it touches code. This is deliberately one pass: the
 * owner sees what happened and decides whether to push again, rather than the
 * building looping unattended until a budget runs out.
 */
export async function pursueGoal(
  deps: OrchestrationDeps,
  goal: string,
  options: { maxTasks?: number; maxReworks?: number } = {},
): Promise<GoalOutcome> {
  const maxReworks = options.maxReworks ?? 1
  const { building, store, credentials, ask, report } = deps
  const manager = store.floorByRole('manager')
  if (!manager) {
    throw new Error(`${building.name} has no manager. Hire one first: roofscape hire manager --building ${building.id}`)
  }

  // A budget that is merely advisory is not a budget. This one was stored on
  // every building and read by nothing at all, which is worse than not having
  // it: the owner believes there is a ceiling.
  // One at a time. The daemon runs standing orders while nobody is watching and
  // the owner may type a goal at the same moment; two managers assigning at once
  // makes duplicate work and an unreadable transcript.
  const holder = deps.holder ?? `pid:${process.pid}`
  const claimed = store.claim(holder)
  if (!claimed.ok) throw new BuildingBusyError(building.name, claimed.heldBy)

  const allowance = building.budget.monthlyTokens
  if (allowance !== null) {
    const spent = store.spentThisMonth()
    if (spent >= allowance) {
      throw new BudgetReachedError(building.name, spent, allowance)
    }
  }

  const before = store.spentSince('1970-01-01T00:00:00.000Z')
  const workspace = new Workspace(building.workspace)

  // Renewed as the work goes on, so a long goal does not have its claim expire
  // under it — and a goal that dies stops renewing and frees the building.
  const renewal = setInterval(() => store.renewClaim(holder), 60_000)
  renewal.unref()

  try {
  report(`${manager.name} is reading the goal…`)
  const managerTurn = await runFloorTurn({
    building, store, credentials, floor: manager, task: null,
    instruction: [
      `The owner has asked for this:`,
      '',
      `  ${goal}`,
      '',
      'Break it into tasks and assign each to the colleague whose job it is, with',
      'acceptance criteria. If nobody here does one of the jobs, say so in your',
      'finish summary rather than assigning it to the nearest person.',
      '',
      'Do not assign anyone to review. Finished work goes to the reviewer',
      'automatically, in the worktree where it was done.',
    ].join('\n'),
    workspace, cwd: building.workspace, ask,
    ...(deps.resolveModel ? { resolveModel: deps.resolveModel } : {}),
    onEvent: (event) => deps.onEvent?.(manager, event),
  })

  // Whatever the manager assigned takes the building's per-task ceiling, which
  // was likewise stored and never applied.
  for (const fresh of store.tasks({ state: 'queued' })) {
    if (fresh.limits.tokens > building.budget.perTaskTokens) {
      store.reLimit(fresh.id, { ...fresh.limits, tokens: building.budget.perTaskTokens })
    }
  }

  const queued = store.tasks({ state: 'queued' }).slice(0, options.maxTasks ?? 6)
  if (queued.length === 0) {
    report('No tasks were assigned.')
  } else {
    report(`${queued.length} task${queued.length === 1 ? '' : 's'} assigned.`)
  }

  const worked: GoalOutcome['worked'] = []

  for (const task of queued) {
    const assignee = store.floor(task.assignedTo)
    if (!assignee) continue

    report(`${assignee.name}: ${truncate(task.goal, 70)}`)
    store.setTaskState(task.id, 'working')

    const workplace = await placeToWork(building, task, assignee)
    try {
      const turn = await runFloorTurn({
        building, store, credentials, floor: assignee, task,
        workspace: workplace.workspace, cwd: workplace.cwd, ask,
        ...(deps.resolveModel ? { resolveModel: deps.resolveModel } : {}),
        onEvent: (event) => deps.onEvent?.(assignee, event),
      })

      let branch: string | null = null
      if (workplace.branch) {
        const changed = await summariseWork(workplace.cwd, 'HEAD')
        if (changed.files.length > 0) {
          await commitAll(workplace.cwd, `${task.goal}\n\nBy ${assignee.name}, for task ${task.id}.`)
          branch = workplace.branch
        }
      }

      const result = asTaskResult(turn)
      const succeeded = turn.finished?.succeeded ?? false
      store.settle(task.id, succeeded ? 'awaiting-review' : 'escalated', {
        ...result,
        artifacts: branch ? [...result.artifacts, `branch:${branch}`] : result.artifacts,
      })
      report(`  ${succeeded ? 'done' : 'stopped'} — ${truncate(result.summary, 90)}`)

      // Work that claims to be finished is read by somebody who could not have
      // written it. Work that already failed is not: there is nothing to judge,
      // and a review of an admitted failure is a turn spent agreeing.
      const reviewDeps = {
        building, store, credentials, ask, report,
        ...(deps.resolveModel ? { resolveModel: deps.resolveModel } : {}),
      }

      let review = succeeded ? await reviewWork(reviewDeps, task, workplace.cwd, result.summary) : null
      let summary = result.summary
      let reworks = 0

      // Work sent back goes back to the person who did it, with the verdict in
      // front of them. Without this the review was only ever a comment: the
      // task was marked escalated and quietly dropped, and the whole point of
      // having a reader is that something happens when they object.
      //
      // Bounded at one attempt. Two people who disagree do not converge by
      // being asked again, and an unbounded loop here is a budget on fire.
      while (review && !review.accepted && reworks < maxReworks) {
        reworks += 1
        report(`  sent back by ${review.by} — ${truncate(firstLine(review.verdict), 70)}`)
        report(`  ${assignee.name} is having another go.`)

        const again = await runFloorTurn({
          building, store, credentials, floor: assignee, task,
          instruction: [
            'Your work was read and sent back. Address what the reviewer said, and',
            'change nothing else.',
            '',
            `What was asked: ${task.goal}`,
            '',
            `What you did: ${summary}`,
            '',
            `What ${review.by} said:`,
            review.verdict.slice(0, 3000),
          ].join('\n'),
          workspace: workplace.workspace, cwd: workplace.cwd, ask,
          ...(deps.resolveModel ? { resolveModel: deps.resolveModel } : {}),
          onEvent: (event) => deps.onEvent?.(assignee, event),
        })

        summary = again.finished?.summary ?? again.note
        if (workplace.branch) {
          const changed = await summariseWork(workplace.cwd, 'HEAD')
          if (changed.files.length > 0) {
            await commitAll(workplace.cwd, `Address review of ${task.id}\n\n${truncate(summary, 400)}`)
            branch = workplace.branch
          }
        }
        review = await reviewWork(reviewDeps, task, workplace.cwd, summary)
      }

      if (review) {
        store.setTaskState(task.id, review.accepted ? 'done' : 'escalated')
        report(
          review.accepted
            ? `  accepted by ${review.by}${reworks > 0 ? ` after ${reworks} rework` : ''}`
            : `  still not right after ${reworks} rework — left for you`,
        )
      }

      recordWhatHappened(store, { task, assignee, summary, succeeded, branch, review, reworks })
      worked.push({ task, floor: assignee, summary, succeeded, branch, review, reworks })
    } finally {
      if (workplace.branch) await closeWorktree(building.workspace, workplace.cwd, { keepBranch: true })
    }
  }

  return {
    managerSummary: managerTurn.finished?.summary ?? managerTurn.note,
    worked,
    outstanding: store.tasks({ state: 'queued' }).length,
    tokensSpent: store.spentSince('1970-01-01T00:00:00.000Z') - before,
  }
  } finally {
    clearInterval(renewal)
    store.releaseClaim(holder)
  }
}

/**
 * Where a task is done. Code work gets a worktree of its own; everything else
 * works in the building's workspace directly, because a worktree for a task that
 * writes no code is a directory nobody looks at.
 */
async function placeToWork(building: Building, task: Task, assignee: Floor) {
  const writesCode = assignee.role === 'coder' || assignee.role === 'ops'
  if (!writesCode || !isRepo(building.workspace)) {
    return { workspace: new Workspace(building.workspace), cwd: building.workspace, branch: null as string | null }
  }

  const branch = `roofscape/${task.id}`
  const path = join(mkdtempSync(join(tmpdir(), 'roofscape-work-')), 'tree')
  const opened = await openWorktree(building.workspace, branch, path)
  if (!opened.ok) {
    return { workspace: new Workspace(building.workspace), cwd: building.workspace, branch: null as string | null }
  }
  return { workspace: new Workspace(opened.path), cwd: opened.path, branch: opened.branch }
}

/**
 * Write down what happened, whether or not anyone thought to.
 *
 * The first two real runs left the archives completely empty: every agent
 * finished its task and none called `remember`. Episodic memory cannot depend on
 * an agent's goodwill — history is recorded by the building, and the curator
 * promotes what recurs into stated facts later. The `remember` tool stays for
 * what an agent actually learned, which is a different thing from what it did.
 */
export function recordWhatHappened(
  store: BuildingStore,
  event: {
    task: Task
    assignee: Floor
    summary: string
    succeeded: boolean
    branch: string | null
    review: Review | null
    reworks?: number
  },
): void {
  // Kept short on purpose. A note is paid for every time it is recalled, and a
  // long one also dilutes its own ranking — the words that matter are drowned by
  // the ones that do not. The first version of this pasted whole review verdicts
  // in and produced 1,500-character notes.
  const parts = [
    `${event.assignee.name} (${event.assignee.role}) was asked to: ${truncate(event.task.goal, 160)}`,
    event.succeeded ? `Outcome: ${truncate(event.summary, 240)}` : `Not finished: ${truncate(event.summary, 240)}`,
  ]
  if (event.branch) parts.push(`On branch ${event.branch}.`)
  if (event.reworks) parts.push(`It went back ${event.reworks} time${event.reworks === 1 ? '' : 's'} first.`)
  if (event.review) {
    parts.push(`${event.review.by} ${event.review.accepted ? 'accepted it' : 'sent it back'}: ${truncate(firstLine(event.review.verdict), 120)}`)
  }

  store.remember({
    scope: 'building',
    layer: 'episodic',
    text: parts.join(' '),
    source: event.task.id,
    confidence: 0.9,
  })
}

/**
 * Hand the work to the reviewer, if there is one.
 *
 * The reviewer is given the diff and the acceptance criteria and nothing that
 * can change a file, so its only possible output is a judgement. A building
 * without a reviewer simply skips this — it is not made up by the manager.
 */
async function reviewWork(
  deps: Pick<OrchestrationDeps, 'building' | 'store' | 'credentials' | 'ask' | 'report' | 'resolveModel'>,
  task: Task,
  where: string,
  summary: string,
): Promise<Review | null> {
  const { building, store, credentials, ask } = deps
  const reviewer = store.floorByRole('reviewer')
  if (!reviewer) return null

  const diff = await fullDiff(where, 'HEAD')
  const turn = await runFloorTurn({
    building, store, credentials, floor: reviewer, task: null,
    instruction: [
      'Judge this piece of work against what was asked for.',
      '',
      `What was asked: ${task.goal}`,
      '',
      'It is done when:',
      ...task.acceptance.map((line) => `  · ${line}`),
      '',
      `What the author says they did: ${summary}`,
      '',
      diff.trim().length > 0 ? `The change:\n\n${diff.slice(0, 12_000)}` : '(No file changes were made.)',
      '',
      'Say for each criterion whether it is met, then give a verdict. Put the word',
      'ACCEPT or REJECT at the start of your finish summary.',
    ].join('\n'),
    workspace: new Workspace(where), cwd: where, ask,
    ...(deps.resolveModel ? { resolveModel: deps.resolveModel } : {}),
  })

  const verdict = turn.finished?.summary ?? turn.note
  return { by: reviewer.name, accepted: /^\s*accept/i.test(verdict), verdict }
}

/** A verdict's first meaningful line is the verdict; the rest is its working. */
const firstLine = (text: string): string =>
  text.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? text

const truncate = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
