import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelMessage } from 'ai'
import { compressWorkingMemory, sizeOf } from './working.js'

const task = (text: string): ModelMessage => ({ role: 'user', content: text })
const said = (text: string): ModelMessage => ({ role: 'assistant', content: text })

const called = (id: string, name: string): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: name, input: {} }],
})

const answered = (id: string, name: string, text: string): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'text', value: text } }],
})

/** A conversation with `pairs` tool exchanges, each returning `bulk` characters. */
function conversation(pairs: number, bulk: number): ModelMessage[] {
  const messages: ModelMessage[] = [task('Add a farewell function to greet.js')]
  for (let i = 0; i < pairs; i++) {
    messages.push(called(`c${i}`, 'search'), answered(`c${i}`, 'search', `match ${i} `.repeat(bulk / 9)))
  }
  return messages
}

test('a short conversation is left completely alone', () => {
  const messages = conversation(2, 100)
  const result = compressWorkingMemory(messages, { budget: 60_000 })
  assert.equal(result.saved, 0)
  assert.equal(result.trimmed, 0)
  assert.deepEqual(result.messages, messages)
})

test('a long conversation is brought back under budget', () => {
  const messages = conversation(40, 4000)
  const before = sizeOf(messages)
  assert.ok(before > 100_000, 'the fixture is genuinely large')

  const result = compressWorkingMemory(messages, { budget: 40_000 })
  assert.ok(result.trimmed > 0, 'something was trimmed')
  assert.ok(sizeOf(result.messages) < before / 2, `only got from ${before} to ${sizeOf(result.messages)}`)
})

test('every tool call still has its result, because a lone call is malformed', () => {
  // Dropping messages would save more and would also break the exchange:
  // providers reject a tool call with no answer.
  const messages = conversation(30, 5000)
  const result = compressWorkingMemory(messages, { budget: 20_000 })

  assert.equal(result.messages.length, messages.length, 'nothing is removed, only shortened')
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of result.messages) {
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === 'tool-call') calls.add(part.toolCallId)
      if (part.type === 'tool-result') results.add(part.toolCallId)
    }
  }
  assert.deepEqual([...calls].sort(), [...results].sort(), 'every call is still answered')
})

test('the task itself is never touched', () => {
  // An agent that forgets what it was asked will confidently do the wrong thing.
  const messages = conversation(30, 5000)
  const result = compressWorkingMemory(messages, { budget: 10_000 })
  assert.deepEqual(result.messages[0], messages[0])
})

test('the most recent exchanges are left intact', () => {
  const messages = conversation(30, 5000)
  const result = compressWorkingMemory(messages, { budget: 10_000, keepRecent: 6 })
  for (let i = messages.length - 6; i < messages.length; i++) {
    assert.deepEqual(result.messages[i], messages[i], `message ${i} should be untouched`)
  }
})

test('a trimmed result says what happened and how to get it back', () => {
  const messages = conversation(30, 5000)
  const result = compressWorkingMemory(messages, { budget: 10_000, keepPerResult: 100 })
  const trimmedMessage = result.messages
    .slice(1, -6)
    .find((m) => m.role === 'tool' && Array.isArray(m.content) &&
      m.content.some((p) => p.type === 'tool-result' && p.output.type === 'text' && p.output.value.includes('dropped')))
  assert.ok(trimmedMessage, 'at least one result was trimmed')
  const part = (trimmedMessage!.content as Array<{ type: string; output?: { type: string; value: string } }>)
    .find((p) => p.type === 'tool-result')!
  assert.match(part.output!.value, /Run the tool again/, 'and it says what to do about it')
})

test('short results are not padded out by being trimmed', () => {
  const messages = conversation(40, 50)
  const result = compressWorkingMemory(messages, { budget: 100, keepPerResult: 240 })
  assert.ok(sizeOf(result.messages) <= sizeOf(messages), 'compression never makes it bigger')
})

test('assistant reasoning is left alone; only tool output is bulk', () => {
  const messages: ModelMessage[] = [
    task('Do the thing'),
    said('x'.repeat(20_000)),
    called('c1', 'search'),
    answered('c1', 'search', 'y'.repeat(20_000)),
    said('done'),
  ]
  const result = compressWorkingMemory(messages, { budget: 1000, keepRecent: 1 })
  assert.equal((result.messages[1] as { content: string }).content.length, 20_000, 'what it said is not tool output')
})
