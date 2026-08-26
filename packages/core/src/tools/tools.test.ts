import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_DEFINITIONS, TOOLS_FOR_ROLE, WRITING_TOOLS, definitionsByName } from './definitions.js'
import { buildToolSet, allToolNames } from './toolset.js'
import { qualifiedToolNames } from './claudeAdapter.js'
import type { AgentContext } from './context.js'

const fakeContext = {} as AgentContext

test('every role is given only tools that exist', () => {
  const known = new Set(allToolNames())
  for (const [role, tools] of Object.entries(TOOLS_FOR_ROLE)) {
    for (const name of tools) {
      assert.ok(known.has(name), `${role} is given "${name}", which is not a tool`)
    }
  }
})

test('a floor whose product is judgement holds nothing that writes', () => {
  // The shell clause is the one usually got wrong: withholding write_file while
  // granting shell has withheld nothing, because `sh -c 'echo x > f'` is a write.
  for (const role of ['reviewer']) {
    for (const name of TOOLS_FOR_ROLE[role]!) {
      assert.equal(WRITING_TOOLS.has(name), false, `a ${role} was given "${name}", which can change a file`)
    }
  }
})

test('every role can declare itself finished', () => {
  for (const [role, tools] of Object.entries(TOOLS_FOR_ROLE)) {
    assert.ok(tools.includes('finish'), `${role} has no way to report a result`)
  }
})

test('every role can consult the archives', () => {
  for (const [role, tools] of Object.entries(TOOLS_FOR_ROLE)) {
    assert.ok(tools.includes('recall'), `${role} cannot look anything up`)
  }
})

test('both engines are offered the identical tool row', () => {
  // This is the promise in docs/decisions/0004, and the only thing that keeps it
  // true is that both adapters read one list.
  const allowed = TOOLS_FOR_ROLE.coder!
  const forAiSdk = Object.keys(buildToolSet(fakeContext, allowed))
  const forClaude = qualifiedToolNames(allowed).map((n) => n.replace('mcp__roofscape__', ''))
  assert.deepEqual(forAiSdk, [...allowed], 'the AI SDK adapter drops nothing')
  assert.deepEqual(forClaude, [...allowed], 'the Claude adapter drops nothing')
  assert.deepEqual(forAiSdk, forClaude, 'the two engines must not drift apart')
})

test('an unknown tool name is skipped rather than crashing the turn', () => {
  const built = buildToolSet(fakeContext, ['read_file', 'nonesuch'])
  assert.deepEqual(Object.keys(built), ['read_file'])
})

test('every tool describes itself well enough to be chosen', () => {
  for (const definition of TOOL_DEFINITIONS) {
    assert.ok(definition.description.length > 30, `${definition.name} is barely described`)
    assert.ok(Object.keys(definition.shape).length > 0, `${definition.name} takes no arguments`)
  }
  assert.equal(definitionsByName().size, TOOL_DEFINITIONS.length, 'no two tools share a name')
})
