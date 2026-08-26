import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure } from './failure.js'
import { fallbacksFor } from './roles.js'

const withStatus = (status: number, message = 'failed') =>
  Object.assign(new Error(message), { statusCode: status })

test('a rate limit is worth asking somewhere else', () => {
  for (const error of [withStatus(429), new Error('Rate limit exceeded'), new Error('usage limit reached')]) {
    const failure = classifyFailure(error)
    assert.equal(failure.kind, 'limit')
    assert.equal(failure.worthFallingBackTo, true)
  }
})

test('a bad credential falls back too, but says what is actually wrong', () => {
  // The work should not stop because one key went stale — and the owner still
  // has to be told, or they will wonder why everything got slower.
  const failure = classifyFailure(withStatus(401, 'invalid api key'))
  assert.equal(failure.kind, 'credential')
  assert.equal(failure.worthFallingBackTo, true)
  assert.match(failure.remedy!, /doctor/)
})

test('an outage is worth asking somewhere else', () => {
  for (const error of [withStatus(503), new Error('fetch failed'), new Error('ECONNREFUSED')]) {
    assert.equal(classifyFailure(error).worthFallingBackTo, true)
  }
})

test('a malformed request is not worth asking anyone else', () => {
  // Every provider will refuse a model id that does not exist, so trying each in
  // turn just spends the timeout.
  const failure = classifyFailure(withStatus(404, 'model not found'))
  assert.equal(failure.kind, 'request')
  assert.equal(failure.worthFallingBackTo, false)
})

test('a task too long for the model says to split it, not to try elsewhere', () => {
  const failure = classifyFailure(new Error('context length exceeded'))
  assert.equal(failure.worthFallingBackTo, false)
  assert.match(failure.remedy!, /smaller/)
})

test('a status buried in a cause is still found', () => {
  const outer = new Error('wrapped', { cause: withStatus(429, 'slow down') })
  assert.equal(classifyFailure(outer).kind, 'limit')
})

test('something unrecognised is worth one try elsewhere rather than a dead stop', () => {
  const failure = classifyFailure(new Error('something nobody has seen before'))
  assert.equal(failure.kind, 'unknown')
  assert.equal(failure.worthFallingBackTo, true)
  assert.equal(failure.remedy, null, 'and no advice is invented')
})

test('fallbacks are other providers, best first, never the one that just failed', () => {
  const current = { provider: 'anthropic', model: 'claude-opus-4-5', engine: 'direct' as const }
  const options = fallbacksFor('manager', ['anthropic', 'openai', 'google'], current)
  assert.ok(options.length > 0)
  assert.equal(options.some((p) => p.provider === 'anthropic'), false, 'not the one that just failed')
  assert.equal(options[0]!.provider, 'openai', 'and in preference order')
})

test('a role with nowhere else to go gets no fallbacks rather than a bad one', () => {
  const current = { provider: 'anthropic', model: 'claude-opus-4-5', engine: 'direct' as const }
  assert.deepEqual(fallbacksFor('manager', ['anthropic'], current), [])
})
