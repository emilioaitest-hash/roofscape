import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableProviders, defaultPosting, APPETITE_BY_ROLE, describePosting } from './roles.js'
import { resolveLanguageModel, ProviderError } from './resolve.js'
import { PROVIDERS, providerSpec, isLocal } from './catalog.js'

const none = { credentialFor: () => null }
const withKeys = (...names: string[]) => ({
  credentialFor: (n: string) => (names.includes(n) ? 'sk-test' : null),
})

test('a local provider is not called available merely because it needs no key', () => {
  // "Needs no key" and "is installed and running" are different claims. Treating
  // them as one offers a model that may not be there.
  assert.equal(isLocal('ollama'), true)
  assert.equal(availableProviders(none).includes('ollama'), false)
})

test('a provider with a credential is available', () => {
  assert.deepEqual(availableProviders(withKeys('anthropic')), ['anthropic'])
})

test('an environment variable counts as a credential', () => {
  process.env.OPENAI_API_KEY = 'sk-from-env'
  try {
    assert.equal(availableProviders(none).includes('openai'), true)
  } finally {
    delete process.env.OPENAI_API_KEY
  }
})

test('each role is routed by what it actually needs', () => {
  assert.equal(APPETITE_BY_ROLE.manager, 'judgement')
  assert.equal(APPETITE_BY_ROLE.coder, 'code')
  assert.equal(APPETITE_BY_ROLE.curator, 'bulk', 'the largest volume of work should not be the largest bill')
})

test('routing falls back through the preference order to what is installed', () => {
  const only = defaultPosting('manager', ['deepseek', 'groq'])
  assert.equal(only, null, 'a manager is not given a model that is not preferred for judgement')

  const withOpenAI = defaultPosting('manager', ['openai'])
  assert.equal(withOpenAI?.provider, 'openai')

  const best = defaultPosting('manager', ['openai', 'anthropic'])
  assert.equal(best?.provider, 'anthropic', 'the first preference wins when both are present')
})

test('bulk work prefers the cheap options and never the most expensive', () => {
  const posting = defaultPosting('curator', ['anthropic', 'groq'])
  assert.equal(posting?.provider, 'groq', 'a curator does not run on the flagship model')
})

test('no posting is invented when nothing is available', () => {
  assert.equal(defaultPosting('coder', []), null)
})

test('a missing credential fails with the variable that would fix it', () => {
  try {
    resolveLanguageModel({ provider: 'anthropic', model: 'claude-opus-4-5', engine: 'direct' }, none)
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ProviderError)
    assert.match(error.remedy, /ANTHROPIC_API_KEY/, 'the remedy names the variable')
  }
})

test('an unknown provider is refused by name', () => {
  try {
    resolveLanguageModel({ provider: 'nonesuch', model: 'x', engine: 'direct' }, none)
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ProviderError)
    assert.match(error.message, /nonesuch/)
  }
})

test('every catalogued provider is complete enough to use', () => {
  for (const spec of PROVIDERS) {
    assert.ok(spec.label.length > 0, `${spec.name} has no label`)
    assert.ok(spec.note.length > 0, `${spec.name} has no note to choose by`)
    if (spec.needsKey) assert.ok(spec.envVar, `${spec.name} needs a key but names no variable`)
    if (spec.kind === 'openai-compatible') assert.ok(spec.baseUrl, `${spec.name} has no base url`)
    assert.equal(providerSpec(spec.name), spec)
  }
})

test('a posting reads as something a person can check', () => {
  assert.match(describePosting({ provider: 'anthropic', model: 'claude-opus-4-5', engine: 'direct' }), /Anthropic · claude-opus-4-5/)
  assert.match(
    describePosting({ provider: 'anthropic', model: 'claude-opus-4-5', engine: 'claude-agent-sdk' }),
    /via Claude Code/,
  )
})
