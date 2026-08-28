import { generateText, stepCountIs, type LanguageModel, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import { coreSystemPrompt, taskPrompt } from './prompt.js'
import { newGuardState, observe, shouldStop, loopingOn, explainStop, type Guard, type GuardState } from './guardrails.js'
import { buildToolSet, TOOLS_FOR_ROLE } from '../tools/toolset.js'
import type { AgentContext, EscalationKind } from '../tools/context.js'
import { resolveLanguageModel, type Credentials } from '../providers/resolve.js'
import { fallbacksFor, availableProviders } from '../providers/roles.js'
import { classifyFailure, type Failure } from '../providers/failure.js'
import { runClaudeTurn } from './claudeEngine.js'
import { compressWorkingMemory } from './working.js'
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
  /**
   * Why no model answered, when none did.
   *
   * Null means a model ran the turn — whatever it then did or did not do. This
   * is the difference between "the building thought about it and got nowhere"
   * and "the building never opened its mouth", and without it the two were
   * reported to the owner identically: as a goal that finished.
   */
  failure: Failure | null
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

  // Post is counted, not delivered. Handing an agent its inbox unasked would
  // put it in every prompt whether or not it matters; being told there is some
  // costs a line, and `check_mail` fetches it only when it is worth reading.
  const unread = allowed.includes('check_mail') ? store.inbox(floor.id).length : 0

  const system = coreSystemPrompt({
    building,
    floor,
    colleagues: store.staff(),
    pinned: store.pinned(floor.id),
    workspaceDisplay: workspace.display(cwd),
    memoryCount: store.memoryCount(),
    unread,
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
      // Only when nothing ran at all. Claude Code also reports an error for a
      // turn that hit its own limits after real work, and that is the agent's
      // story rather than a provider that could not be reached.
      failure: claude.error && !claude.finished && claude.turns === 0 ? claudeEngineFailure(claude.error) : null,
    }
  }

  // A guard that only runs between steps cannot stop a call that never returns.
  // The first smoke test hung for fifteen minutes inside a single request while
  // a 300s task budget sat unconsumed, because no step had finished for it to
  // check. This signal is the only thing that stops that case, and it spans
  // every attempt: falling back must not reset the clock.
  const deadline = AbortSignal.timeout(guard.timeoutSeconds * 1000)

  const build = request.resolveModel ?? ((posting: Floor['posting']) => resolveLanguageModel(posting, credentials))

  // Where this floor could work instead, if its own provider will not answer.
  // A manager on a smaller model is worse than a manager on the right one, and
  // very much better than no manager — which is the alternative.
  const attempts: Floor['posting'][] = [
    floor.posting,
    ...fallbacksFor(floor.role, availableProviders(credentials), floor.posting),
  ]

  let result: Awaited<ReturnType<typeof generateText>> | null = null
  let used = floor.posting
  let lastFailure: Failure | null = null

  for (const [index, posting] of attempts.entries()) {
    try {
      result = await generateText({
        model: build(posting),
        system,
        messages,
        tools,
        abortSignal: deadline,
        maxOutputTokens: 8000,
        // Working memory. Without this a long task pays for every earlier step's
        // output on every later step, and a twenty-minute-old `search` result is
        // charged for again and again.
        prepareStep: ({ messages: soFar }) => {
          const compressed = compressWorkingMemory(soFar)
          if (compressed.saved > 0) {
            request.onEvent?.({
              kind: 'step',
              detail: `trimmed ${compressed.saved.toLocaleString()} characters of earlier tool output`,
            })
            return { messages: compressed.messages }
          }
          return {}
        },
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
      used = posting
      break
    } catch (error) {
      if (deadline.aborted) {
        state.stoppedBy = 'timeout'
        lastFailure = { kind: 'unavailable', worthFallingBackTo: false, message: 'no answer in time', remedy: null }
        break
      }
      lastFailure = classifyFailure(error)
      const more = index < attempts.length - 1
      if (!lastFailure.worthFallingBackTo || !more) break
      request.onEvent?.({
        kind: 'stopped',
        detail: `${posting.provider} could not take it (${lastFailure.kind}); trying ${attempts[index + 1]!.provider}`,
      })
    }
  }

  if (!result) {
    // Spend still happened even though the turn did not finish, and a budget
    // that ignores failed attempts is a budget that can be exhausted for free.
    store.recordSpend({
      floor: floor.id,
      task: task?.id ?? null,
      provider: used.provider,
      model: used.model,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })
    const note =
      state.stoppedBy === 'timeout'
        ? `Stopped: no answer within ${guard.timeoutSeconds}s. The model or provider is not responding.`
        : lastFailure
          ? `${lastFailure.message}${lastFailure.remedy ? ` — ${lastFailure.remedy}` : ''}`
          : 'The model call failed.'
    request.onEvent?.({ kind: 'stopped', detail: note })
    return {
      text: '',
      finished: null,
      usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
      steps: state.steps,
      stoppedBy: state.stoppedBy,
      note,
      failure: lastFailure ?? { kind: 'unknown', worthFallingBackTo: false, message: note, remedy: null },
    }
  }

  const finished =
    finishCall(result.steps) ??
    (state.stoppedBy === null && result.finishReason === 'stop' && result.text.trim().length > 0
      ? { summary: result.text.trim(), artifacts: [], succeeded: true }
      : null)

  // Attributed to whichever posting actually answered, not the one that was
  // asked first — otherwise a fallback's cost is filed under a provider that
  // did no work.
  store.recordSpend({
    floor: floor.id,
    task: task?.id ?? null,
    provider: used.provider,
    model: used.model,
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
    // A model answered. Anything disappointing about the answer is the agent's,
    // not the provider's, and must not be reported as a provider being down.
    failure: null,
  }
}

/**
 * The Claude Code engine reports in prose rather than in status codes, so the
 * two failures a person can actually act on are named here. Anything else keeps
 * its own words, which are usually better than a category.
 */
function claudeEngineFailure(error: string): Failure {
  if (/not installed|not on the PATH/i.test(error)) {
    return {
      kind: 'credential',
      worthFallingBackTo: true,
      message: error,
      remedy: 'Install Claude Code, or post this floor to a provider with an API key: roofscape provider add anthropic',
    }
  }
  if (/not logged in/i.test(error)) {
    return {
      kind: 'credential',
      worthFallingBackTo: true,
      message: error,
      remedy: 'Run `claude` once in a terminal and sign in.',
    }
  }
  return { kind: 'unavailable', worthFallingBackTo: true, message: error, remedy: null }
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
