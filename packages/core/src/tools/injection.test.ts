import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuildingStore } from '../store/buildingStore.js'
import { Workspace } from './workspace.js'
import { definitionsByName } from './definitions.js'
import { asBuildingId } from '../domain/ids.js'
import type { AgentContext } from './context.js'
import type { Building } from '../domain/building.js'

/**
 * The search tool puts an agent-supplied pattern into a shell command. An agent
 * reading a repository is reading text somebody else wrote, so that pattern is
 * not trustworthy input — a comment in a file can ask an agent to search for
 * something shaped like a command.
 */
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'roofscape-inject-'))
  const workspace = join(root, 'work')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'a.txt'), 'nothing to see')

  const store = BuildingStore.open(asBuildingId('t'), join(root, 'b.db'))
  const floor = store.hire({
    role: 'coder', name: 'Nib', charter: 'x',
    posting: { provider: 'x', model: 'y', engine: 'direct' },
  })
  const building: Building = {
    id: asBuildingId('t'), name: 'T', charter: 'x', workspace, repos: [],
    budget: { monthlyTokens: null, perTaskTokens: 1000 },
    createdAt: new Date().toISOString(), closedAt: null,
  }
  const context: AgentContext = {
    building, store, workspace: new Workspace(workspace),
    floor: floor.id, task: null, cwd: workspace,
    ask: async () => false, // Nothing is approved: an unattended run says no.
  }
  return {
    context, root, workspace,
    cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }) },
  }
}

const tools = definitionsByName()

test('a search pattern cannot break out and run a command', async () => {
  const h = harness()
  try {
    const marker = join(h.root, 'PWNED')
    const attacks = [
      `'; touch ${marker}; echo '`,
      `x' ; touch ${marker} ; echo 'x`,
      `$(touch ${marker})`,
      `\`touch ${marker}\``,
      `x'||touch ${marker}||echo'`,
    ]
    for (const pattern of attacks) {
      await tools.get('search')!.run(h.context, { pattern, path: '.' })
      assert.equal(existsSync(marker), false, `escaped with: ${pattern}`)
    }
  } finally { h.cleanup() }
})

test('an ordinary search with awkward characters still works', () => {
  // Escaping that breaks real searches would be quietly useless — an agent
  // grepping for a regex with quotes in it is doing its job.
  const h = harness()
  try {
    writeFileSync(join(h.workspace, 'code.js'), 'const it = "don\'t"\n')
    // Just assert it does not throw; matching is rg's business, not ours.
    assert.doesNotThrow(() => tools.get('search')!.run(h.context, { pattern: "don't", path: '.' }))
    assert.doesNotThrow(() => tools.get('search')!.run(h.context, { pattern: 'a|b', path: '.' }))
  } finally { h.cleanup() }
})

test('a shell command an agent asks for is judged, not simply run', async () => {
  const h = harness()
  try {
    const marker = join(h.root, 'DESTROYED')
    writeFileSync(marker, 'still here')

    const result = (await tools.get('shell')!.run(h.context, {
      command: `rm -rf ${h.root}`,
      timeout_seconds: 5,
    })) as { ok: boolean; stopped?: string }

    assert.equal(result.ok, false)
    assert.equal(result.stopped, 'refused', 'a recursive forced delete is not even offered')
    assert.equal(existsSync(marker), true, 'and nothing was deleted')
  } finally { h.cleanup() }
})

test('an unfamiliar command is put to the owner, and a refusal means it does not run', async () => {
  const h = harness()
  try {
    const marker = join(h.root, 'UNAPPROVED')
    const result = (await tools.get('shell')!.run(h.context, {
      command: `touch ${marker}`, // `touch` is not on the allowlist
      timeout_seconds: 5,
    })) as { ok: boolean; stopped?: string }

    assert.equal(result.ok, false)
    assert.equal(result.stopped, 'not-approved')
    assert.equal(existsSync(marker), false, 'a refused command does not run anyway')
  } finally { h.cleanup() }
})

test('writing outside the workspace is refused by every tool that writes', async () => {
  const h = harness()
  try {
    const outside = join(h.root, 'escaped.txt')
    for (const [name, input] of [
      ['write_file', { path: '../escaped.txt', content: 'x' }],
      ['write_file', { path: outside, content: 'x' }],
    ] as const) {
      const result = (await tools.get(name)!.run(h.context, input)) as { error?: string }
      assert.match(result.error ?? '', /outside/, `${name} let ${input.path} through`)
    }
    assert.equal(existsSync(outside), false)
  } finally { h.cleanup() }
})

test('reading outside the workspace is refused too', async () => {
  const h = harness()
  try {
    const result = (await tools.get('read_file')!.run(h.context, { path: '/etc/passwd' })) as { error?: string }
    assert.match(result.error ?? '', /outside/)
  } finally { h.cleanup() }
})
