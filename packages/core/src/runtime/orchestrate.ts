import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runFloorTurn, asTaskResult, type TurnEvent } from './run.js'
import { Workspace } from '../tools/workspace.js'
import { openWorktree, closeWorktree, summariseWork, commitAll, isRepo, fullDiff } from '../tools/git.js'
import type { BuildingStore } from '../store/buildingStore.js'
import type { Credentials } from '../providers/resolve.js'
import type { Building, Floor } from '../domain/building.js'
import type { Task } from '../domain/work.js'
import type { EscalationKind } from '../tools/context.js'

export interface OrchestrationDeps {
  building: Building
  store: BuildingStore
  credentials: Credentials
  ask: (kind: EscalationKind, intent: string) => Promise<boolean>
  report: (line: string) => void
  onEvent?: (floor: Floor, event: TurnEvent) => void
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
  }>
  outstanding: number
  tokensSpent: number
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
export async function pursueGoal(deps: OrchestrationDeps, goal: string, options: { maxTasks?: number } = {}): Promise<GoalOutcome> {
  const { building, store, credentials, ask, report } = deps
  const manager = store.floorByRole('manager')
  if (!manager) {
    throw new Error(`${building.name} has no manager. Hire one first: roofscape hire manager --building ${building.id}`)
  }

  const before = store.spentSince('1970-01-01T00:00:00.000Z')
  const workspace = new Workspace(building.workspace)

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
    ].join('\n'),
    workspace, cwd: building.workspace, ask,
    onEvent: (event) => deps.onEvent?.(manager, event),
  })

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
      const review = succeeded
        ? await reviewWork({ building, store, credentials, ask, report }, task, workplace.cwd, result.summary)
        : null
      if (review) {
        store.setTaskState(task.id, review.accepted ? 'done' : 'escalated')
        report(`  ${review.accepted ? 'accepted' : 'sent back'} by ${review.by} — ${truncate(review.verdict, 80)}`)
      }

      worked.push({ task, floor: assignee, summary: result.summary, succeeded, branch, review })
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
 * Hand the work to the reviewer, if there is one.
 *
 * The reviewer is given the diff and the acceptance criteria and nothing that
 * can change a file, so its only possible output is a judgement. A building
 * without a reviewer simply skips this — it is not made up by the manager.
 */
async function reviewWork(
  deps: Pick<OrchestrationDeps, 'building' | 'store' | 'credentials' | 'ask' | 'report'>,
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
  })

  const verdict = turn.finished?.summary ?? turn.note
  return { by: reviewer.name, accepted: /^\s*accept/i.test(verdict), verdict }
}

const truncate = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
