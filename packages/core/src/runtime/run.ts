import { generateText, stepCountIs, type LanguageModel, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import { coreSystemPrompt, taskPrompt } from './prompt.js'
import { newGuardState, observe, shouldStop, loopingOn, explainStop, type Guard, type GuardState } from './guardrails.js'
import { buildToolSet, TOOLS_FOR_ROLE } from '../tools/toolset.js'
import type { AgentContext, EscalationKind } from '../tools/context.js'
import { resolveLanguageModel, type Credentials } from '../providers/resolve.js'
import { runClaudeTurn } from './claudeEngine.js'
import type { Workspace } from '../tools/workspace.js'
import type { BuildingStore } from '../store/buildingStore.js'
import type { Building, Floor } from '../domain/building.js'
import type { Task, TaskResult } from '../domain/work.js'

export interface TurnEvent {
  kind: 'step' | 'tool' | 'stopped'
  detail: string
}

export interface TurnRequest {
  building: Building
  store: BuildingStore
  credentials: Credentials
  floor: Floor
  /** The task being worked. Absent for a one-off instruction. */
  task: Task | null
  /** Used when there is no task, or to add to one. */
  instruction?: string
  workspace: Workspace
  /** Usually a worktree, not the owner's checkout. */
  cwd: string
  ask: (kind: EscalationKind, intent: string) => Promise<boolean>
  onEvent?: (event: TurnEvent) => void
  /**
   * How a posting becomes something callable. Defaults to the provider layer.
   * A seam rather than test scaffolding: a long-running daemon wants to cache
   * models rather than rebuild one per turn, and tests want neither a network
   * nor a key.
   */
  resolveModel?: (posting: Floor['posting']) => LanguageModel
}

export interface TurnOutcome {
  text: string
  /** What `finish` reported, when the agent called it. */
  finished: { summary: string; artifacts: string[]; succeeded: boolean } | null
  usage: { inputTokens: number; outputTokens: number }
  steps: number
  stoppedBy: GuardState['stoppedBy']
  note: string
}

/**
 * Run one floor for one turn.
 *
 * The turn ends when the agent calls `finish`, or when a guard stops it. There
 * is no fourth option: a turn that merely runs out of things to say still
 * returns, and the absence of `finish` is itself the result.
 */
export async function runFloorTurn(request: TurnRequest): Promise<TurnOutcome> {
  const { building, store, floor, task, workspace, cwd, credentials } = request

  const guard: Guard = {
    tokenBudget: task?.limits.tokens ?? 40_000,
    timeoutSeconds: task?.limits.timeoutSeconds ?? 600,
    maxSteps: 40,
  }
  const state = newGuardState()

  const context: AgentContext = {
    building,
    store,
    workspace,
    floor: floor.id,
    task: task?.id ?? null,
    ask: request.ask,
    cwd,
  }

  const allowed = floor.tools.length > 0 ? floor.tools : (TOOLS_FOR_ROLE[floor.role] ?? TOOLS_FOR_ROLE.coder!)
  const tools = buildToolSet(context, allowed)

  const system = coreSystemPrompt({
    building,
    floor,
    colleagues: store.staff(),
    pinned: store.pinned(floor.id),
    workspaceDisplay: workspace.display(cwd),
    memoryCount: store.memoryCount(),
  })

  const messages: ModelMessage[] = [
    { role: 'user', content: task ? taskPrompt(task) : (request.instruction ?? 'Report on where things stand.') },
  ]

  // Two engines, one tool row. Which one ran the turn changes what it cost and
  // never what the agent could do.
  if (floor.posting.engine === 'claude-agent-sdk') {
    const claude = await runClaudeTurn({
      context,
      system,
      prompt: task ? taskPrompt(task) : (request.instruction ?? 'Report on where things stand.'),
      allowedTools: allowed,
      maxTurns: guard.maxSteps,
      timeoutSeconds: guard.timeoutSeconds,
      ...(floor.posting.model ? { model: floor.posting.model } : {}),
      onTool: (name) => request.onEvent?.({ kind: 'tool', detail: name }),
    })

    store.recordSpend({
      floor: floor.id,
      task: task?.id ?? null,
      provider: floor.posting.provider,
      model: floor.posting.model,
      inputTokens: claude.inputTokens,
      outputTokens: claude.outputTokens,
    })

    const note = claude.error ?? (claude.finished ? 'Finished.' : 'Stopped without calling finish, so the work is not accounted for.')
    if (!claude.finished) request.onEvent?.({ kind: 'stopped', detail: note })

    return {
      text: claude.text,
      finished: claude.finished,
      usage: { inputTokens: claude.inputTokens, outputTokens: claude.outputTokens },
      steps: claude.turns,
      stoppedBy: claude.error ? 'timeout' : null,
      note,
    }
  }

  const model = (request.resolveModel ?? ((posting) => resolveLanguageModel(posting, credentials)))(floor.posting)

  // A guard that only runs between steps cannot stop a call that never returns.
  // The first smoke test hung for fifteen minutes inside a single request while
  // a 300s task budget sat unconsumed, because no step had finished for it to
  // check. This signal is the only thing that stops that case.
  const deadline = AbortSignal.timeout(guard.timeoutSeconds * 1000)

  let result
  try {
    result = await generateText({
      model,
      system,
      messages,
      tools,
      abortSignal: deadline,
      maxOutputTokens: 8000,
      stopWhen: [
        stepCountIs(guard.maxSteps),
        () => shouldStop(state, guard),
        ({ steps }) => finishCall(steps) !== null,
      ],
      onStepFinish: (step) => {
        observe(state, step)
        for (const call of step.toolCalls ?? []) {
          request.onEvent?.({ kind: 'tool', detail: call.toolName })
        }
        const looping = loopingOn(state)
        if (looping) request.onEvent?.({ kind: 'step', detail: `repeating ${looping}` })
      },
    })
  } catch (error) {
    const timedOut = deadline.aborted
    if (timedOut) state.stoppedBy = 'timeout'
    // Spend still happened even though the turn did not finish, and a budget
    // that ignores failed attempts is a budget that can be exhausted for free.
    store.recordSpend({
      floor: floor.id,
      task: task?.id ?? null,
      provider: floor.posting.provider,
      model: floor.posting.model,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })
    return {
      text: '',
      finished: null,
      usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
      steps: state.steps,
      stoppedBy: state.stoppedBy,
      note: timedOut
        ? `Stopped: no answer within ${guard.timeoutSeconds}s. The model or provider is not responding.`
        : `The model call failed: ${(error as Error).message}`,
    }
  }

  // An agent that says its piece and stops has still answered. Discarding that
  // because it did not call `finish` throws away work over a formality — the
  // manager did exactly this on the first real run, assigning a task correctly
  // and then having its summary recorded as "not accounted for". A turn is only
  // unaccounted for when a guard cut it short.
  const finished =
    finishCall(result.steps) ??
    (state.stoppedBy === null && result.finishReason === 'stop' && result.text.trim().length > 0
      ? { summary: result.text.trim(), artifacts: [], succeeded: true }
      : null)

  store.recordSpend({
    floor: floor.id,
    task: task?.id ?? null,
    provider: floor.posting.provider,
    model: floor.posting.model,
    inputTokens: result.totalUsage?.inputTokens ?? state.inputTokens,
    outputTokens: result.totalUsage?.outputTokens ?? state.outputTokens,
  })

  const note = finished
    ? 'Finished.'
    : state.stoppedBy
      ? explainStop(state, guard)
      : 'Stopped without saying anything, so there is nothing to record.'

  if (!finished) request.onEvent?.({ kind: 'stopped', detail: note })

  return {
    text: result.text,
    finished,
    usage: {
      inputTokens: result.totalUsage?.inputTokens ?? state.inputTokens,
      outputTokens: result.totalUsage?.outputTokens ?? state.outputTokens,
    },
    steps: result.steps.length,
    stoppedBy: state.stoppedBy,
    note,
  }
}

/** The `finish` call, if the agent made one. Its arguments are the result. */
function finishCall(steps: readonly StepResult<ToolSet>[]): TurnOutcome['finished'] {
  for (let i = steps.length - 1; i >= 0; i--) {
    for (const call of steps[i]!.toolCalls ?? []) {
      if (call.toolName === 'finish') {
        const input = call.input as { summary?: string; artifacts?: string[]; succeeded?: boolean }
        return {
          summary: input.summary ?? '',
          artifacts: input.artifacts ?? [],
          succeeded: input.succeeded ?? true,
        }
      }
    }
  }
  return null
}

/** Turn an outcome into the record a task settles with. */
export const asTaskResult = (outcome: TurnOutcome): TaskResult => ({
  summary: outcome.finished?.summary ?? outcome.note,
  artifacts: outcome.finished?.artifacts ?? [],
  tokensSpent: outcome.usage.outputTokens,
})
