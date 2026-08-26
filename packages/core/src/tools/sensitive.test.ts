import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isProbablySecret } from './sensitive.js'
import { definitionsByName } from './definitions.js'
import { Workspace } from './workspace.js'
import { BuildingStore } from '../store/buildingStore.js'
import { asBuildingId } from '../domain/ids.js'
import type { AgentContext } from './context.js'
import type { Building } from '../domain/building.js'

test('the usual homes of a secret are recognised', () => {
  for (const path of [
    '.env', '.env.local', '.env.production', 'src/.env',
    'id_rsa', 'deploy.pem', 'server.key', 'credentials.json',
    '.npmrc', '.netrc', 'secrets.yaml', 'my-secret-config.json',
    'certs/client.p12', '.git-credentials',
  ]) {
    assert.equal(isProbablySecret(path), true, `${path} should be treated as a secret`)
  }
})

test('the things that only look like one are not', () => {
  // Refusing these would be noise, and noise is what teaches people to approve
  // without reading.
  for (const path of [
    'id_rsa.pub', '.env.example', '.env.sample', '.env.template',
    'index.js', 'README.md', 'package.json', 'keyboard.ts', 'monkey.js',
  ]) {
    assert.equal(isProbablySecret(path), false, `${path} should not be treated as a secret`)
  }
})

function harness(answer: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'roofscape-secret-'))
  const ws = join(root, 'w')
  mkdirSync(ws)
  writeFileSync(join(ws, '.env'), 'ANTHROPIC_API_KEY=sk-ant-the-real-one\n')
  writeFileSync(join(ws, 'index.js'), 'export const hello = 1\n')

  const store = BuildingStore.open(asBuildingId('t'), join(root, 'b.db'))
  const floor = store.hire({
    role: 'coder', name: 'N', charter: 'x',
    posting: { provider: 'x', model: 'y', engine: 'direct' },
  })
  const building: Building = {
    id: asBuildingId('t'), name: 'T', charter: '', workspace: ws, repos: [],
    budget: { monthlyTokens: null, perTaskTokens: 1 }, createdAt: '', closedAt: null,
  }
  const asked: string[] = []
  const context: AgentContext = {
    building, store, workspace: new Workspace(ws), floor: floor.id, task: null, cwd: ws,
    ask: async (_kind, intent) => { asked.push(intent); return answer },
  }
  return { context, asked, cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }) } }
}

const read = definitionsByName().get('read_file')!

test('reading a .env is put to the owner, and a refusal means it is not read', async () => {
  const h = harness(false)
  try {
    const result = (await read.run(h.context, { path: '.env' })) as { error?: string; content?: string }
    assert.equal(h.asked.length, 1, 'the owner was asked')
    assert.match(h.asked[0]!, /archives/, 'and told why it matters')
    assert.equal(result.content, undefined, 'nothing was read')
    assert.match(result.error ?? '', /did not agree/)
  } finally { h.cleanup() }
})

test('if the owner agrees, it is read — they may have a good reason', async () => {
  const h = harness(true)
  try {
    const result = (await read.run(h.context, { path: '.env' })) as { content?: string }
    assert.match(result.content ?? '', /sk-ant-the-real-one/)
  } finally { h.cleanup() }
})

test('an ordinary file is read without anybody being interrupted', async () => {
  const h = harness(false)
  try {
    const result = (await read.run(h.context, { path: 'index.js' })) as { content?: string }
    assert.equal(h.asked.length, 0, 'no prompt for an ordinary file')
    assert.match(result.content ?? '', /hello/)
  } finally { h.cleanup() }
})
