import type { StepResult, ToolSet } from 'ai'

/**
 * The three ways a turn is stopped short, and the one way it is nudged.
 *
 * A budget that is merely advisory is not a budget. Each of these ends the turn
 * and escalates, rather than letting it spend more and hope.
 */
export interface Guard {
  /** Output tokens this turn may use before it is stopped. */
  tokenBudget: number
  /** Wall-clock seconds. */
  timeoutSeconds: number
  /** Tool-calling rounds. */
  maxSteps: number
}

export interface GuardState {
  outputTokens: number
  inputTokens: number
  startedAt: number
  steps: number
  stoppedBy: 'budget' | 'timeout' | 'steps' | null
  /** Identical calls seen, keyed by tool and arguments. */
  repeats: Map<string, number>
}

export const newGuardState = (): GuardState => ({
  outputTokens: 0,
  inputTokens: 0,
  startedAt: Date.now(),
  steps: 0,
  stoppedBy: null,
  repeats: new Map(),
})

/** Fold one completed step into the running totals. */
export function observe(state: GuardState, step: StepResult<ToolSet>): void {
  state.steps += 1
  state.outputTokens += step.usage?.outputTokens ?? 0
  state.inputTokens += step.usage?.inputTokens ?? 0
  for (const call of step.toolCalls ?? []) {
    const key = `${call.toolName}:${JSON.stringify(call.input)}`
    state.repeats.set(key, (state.repeats.get(key) ?? 0) + 1)
  }
}

export function shouldStop(state: GuardState, guard: Guard): boolean {
  if (state.outputTokens >= guard.tokenBudget) {
    state.stoppedBy = 'budget'
    return true
  }
  if ((Date.now() - state.startedAt) / 1000 >= guard.timeoutSeconds) {
    state.stoppedBy = 'timeout'
    return true
  }
  if (state.steps >= guard.maxSteps) {
    state.stoppedBy = 'steps'
    return true
  }
  return false
}

/**
 * An agent repeating a call it has already made with identical arguments is not
 * making progress. Three is the point at which saying so is more useful than
 * waiting to see.
 */
export function loopingOn(state: GuardState): string | null {
  for (const [key, count] of state.repeats) {
    if (count >= 3) return key.slice(0, key.indexOf(':'))
  }
  return null
}

export function explainStop(state: GuardState, guard: Guard): string {
  switch (state.stoppedBy) {
    case 'budget':
      return `Stopped: this task's token budget (${guard.tokenBudget.toLocaleString()}) was reached.`
    case 'timeout':
      return `Stopped: this task ran past ${guard.timeoutSeconds}s.`
    case 'steps':
      return `Stopped: ${guard.maxSteps} rounds of tool calls without finishing.`
    default:
      return 'Finished.'
  }
}
