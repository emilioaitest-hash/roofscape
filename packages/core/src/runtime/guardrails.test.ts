import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newGuardState, observe, shouldStop, loopingOn, explainStop, type Guard } from './guardrails.js'
import type { StepResult, ToolSet } from 'ai'

const GUARD: Guard = { tokenBudget: 1000, timeoutSeconds: 60, maxSteps: 5 }

const step = (outputTokens: number, calls: Array<{ toolName: string; input: unknown }> = []) =>
  ({ usage: { outputTokens, inputTokens: 0 }, toolCalls: calls } as unknown as StepResult<ToolSet>)

test('a turn is stopped when the token budget is reached', () => {
  const state = newGuardState()
  observe(state, step(400))
  assert.equal(shouldStop(state, GUARD), false)
  observe(state, step(700))
  assert.equal(shouldStop(state, GUARD), true)
  assert.equal(state.stoppedBy, 'budget')
  assert.match(explainStop(state, GUARD), /budget/)
})

test('a turn is stopped after too many rounds without finishing', () => {
  const state = newGuardState()
  for (let i = 0; i < 5; i++) observe(state, step(1))
  assert.equal(shouldStop(state, GUARD), true)
  assert.equal(state.stoppedBy, 'steps')
})

test('a turn is stopped when it runs past its deadline', () => {
  const state = newGuardState()
  state.startedAt = Date.now() - 61_000
  assert.equal(shouldStop(state, GUARD), true)
  assert.equal(state.stoppedBy, 'timeout')
})

test('an identical call repeated three times is reported as a loop', () => {
  const state = newGuardState()
  const call = { toolName: 'read_file', input: { path: 'a.ts' } }
  observe(state, step(1, [call]))
  assert.equal(loopingOn(state), null)
  observe(state, step(1, [call]))
  assert.equal(loopingOn(state), null, 'twice can be a retry')
  observe(state, step(1, [call]))
  assert.equal(loopingOn(state), 'read_file', 'three times is not making progress')
})

test('the same tool with different arguments is not a loop', () => {
  const state = newGuardState()
  for (const path of ['a.ts', 'b.ts', 'c.ts']) {
    observe(state, step(1, [{ toolName: 'read_file', input: { path } }]))
  }
  assert.equal(loopingOn(state), null, 'reading three files is work, not repetition')
})

test('a turn that simply finished says so', () => {
  assert.equal(explainStop(newGuardState(), GUARD), 'Finished.')
})
