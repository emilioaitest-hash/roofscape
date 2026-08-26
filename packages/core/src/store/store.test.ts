import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkylineStore } from './skylineStore.js'
import { BuildingStore } from './buildingStore.js'
import { slugify } from './idgen.js'
import { asBuildingId } from '../domain/ids.js'
import type { Posting } from '../domain/building.js'

const POSTING: Posting = { provider: 'ollama', model: 'qwen3:4b', engine: 'direct' }

function scratch(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const openSkyline = (dir: string) => SkylineStore.open(join(dir, 'skyline.db'))
const openBuilding = (dir: string, id = 'test') =>
  BuildingStore.open(asBuildingId(id), join(dir, `${id}.db`))

test('a building id is a legible folder name', () => {
  assert.equal(slugify('College App'), 'college-app')
  assert.equal(slugify('  Émilio’s Rowing Site!! '), 'emilio-s-rowing-site')
  assert.notEqual(slugify('///'), '')
})

test('breaking ground twice on the same name does not collide', () => {
  const { dir, cleanup } = scratch()
  try {
    const sky = openSkyline(dir)
    const a = sky.breakGround({ name: 'Rowing', charter: 'x', workspace: '/tmp/a' })
    const b = sky.breakGround({ name: 'Rowing!', charter: 'y', workspace: '/tmp/b' })
    assert.equal(a.id, 'rowing')
    assert.equal(b.id, 'rowing-2')
    assert.equal(sky.list().length, 2)
    sky.close()
  } finally { cleanup() }
})

test('a mothballed building leaves the skyline but not the record', () => {
  const { dir, cleanup } = scratch()
  try {
    const sky = openSkyline(dir)
    const b = sky.breakGround({ name: 'Old', charter: 'x', workspace: '/tmp/o' })
    sky.close_building(b.id)
    assert.equal(sky.list().length, 0)
    assert.equal(sky.list({ includeClosed: true }).length, 1)
    assert.ok(sky.get(b.id)?.closedAt)
    sky.close()
  } finally { cleanup() }
})

test('migrations are applied once and reopening is safe', () => {
  const { dir, cleanup } = scratch()
  try {
    const first = openSkyline(dir)
    first.breakGround({ name: 'A', charter: 'x', workspace: '/tmp/a' })
    first.close()
    const second = openSkyline(dir)
    assert.equal(second.list().length, 1, 'data survives reopening')
    second.close()
  } finally { cleanup() }
})

test('an env credential stores the variable name, not the secret', () => {
  const { dir, cleanup } = scratch()
  try {
    const sky = openSkyline(dir)
    process.env.ROOFSCAPE_TEST_KEY = 'sk-secret'
    sky.putProvider({ name: 'anthropic', baseUrl: null, credentialKind: 'env', credential: 'ROOFSCAPE_TEST_KEY' })
    assert.equal(sky.providers()[0]!.credential, 'ROOFSCAPE_TEST_KEY', 'the database holds only the name')
    assert.equal(sky.credentialFor('anthropic'), 'sk-secret', 'the secret is read from the environment')
    assert.equal(sky.credentialFor('nobody'), null)
    delete process.env.ROOFSCAPE_TEST_KEY
    sky.close()
  } finally { cleanup() }
})

test('the manager is read first however late they were hired', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    b.hire({ role: 'coder', name: 'Nib', charter: 'writes', posting: POSTING })
    b.hire({ role: 'reviewer', name: 'Vet', charter: 'checks', posting: POSTING })
    b.hire({ role: 'manager', name: 'Ada', charter: 'runs it', posting: POSTING })
    const staff = b.staff()
    assert.equal(staff.length, 3)
    assert.equal(staff[0]!.role, 'manager', 'the manager holds the top floor')
    assert.equal(b.headcount(), 3)
    b.close()
  } finally { cleanup() }
})

test('vacating a floor drops the headcount but keeps the record', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const gone = b.hire({ role: 'marketer', name: 'Pitch', charter: 'sells', posting: POSTING })
    b.vacate(gone.id)
    assert.equal(b.headcount(), 0)
    assert.equal(b.staff({ includeVacated: true }).length, 1)
    assert.ok(b.floor(gone.id)?.vacatedAt)
    b.close()
  } finally { cleanup() }
})

test('a task carries limits even when none are given', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const mgr = b.hire({ role: 'manager', name: 'Ada', charter: 'runs it', posting: POSTING })
    const dev = b.hire({ role: 'coder', name: 'Nib', charter: 'writes', posting: POSTING })
    const task = b.assign({ by: mgr.id, to: dev.id, goal: 'Fix the header' })
    assert.ok(task.limits.tokens > 0, 'a task always has a ceiling')
    assert.ok(task.limits.timeoutSeconds > 0)
    assert.equal(task.state, 'queued')
    assert.equal(b.tasks({ assignedTo: dev.id }).length, 1)

    b.settle(task.id, 'done', { summary: 'done', artifacts: ['branch/x'], tokensSpent: 10 })
    const settled = b.task(task.id)!
    assert.equal(settled.state, 'done')
    assert.equal(settled.result?.artifacts[0], 'branch/x')
    assert.ok(settled.settledAt)
    b.close()
  } finally { cleanup() }
})

test('busy floors are counted for lighting the windows', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const mgr = b.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const dev = b.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    assert.equal(b.busyFloors(), 0)
    const t = b.assign({ by: mgr.id, to: dev.id, goal: 'something' })
    assert.equal(b.busyFloors(), 1)
    b.settle(t.id, 'done', null)
    assert.equal(b.busyFloors(), 0, 'a settled task stops lighting a window')
    b.close()
  } finally { cleanup() }
})

test('an inbox holds only unread post, oldest first', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const mgr = b.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const dev = b.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    const first = b.post({ kind: 'task', from: mgr.id, to: dev.id, body: 'one' })
    b.post({ kind: 'question', from: mgr.id, to: dev.id, body: 'two' })
    assert.equal(b.inbox(dev.id).length, 2)
    assert.equal(b.inbox(dev.id)[0]!.body, 'one')
    b.markRead(first.id)
    assert.equal(b.inbox(dev.id).length, 1)
    assert.equal(b.inbox(mgr.id).length, 0, 'post goes to one floor, not all of them')
    b.close()
  } finally { cleanup() }
})

test('anything outward-facing waits at the approval desk', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const mgr = b.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const request = b.requestApproval({ kind: 'hire', by: mgr.id, intent: 'Take on a marketer' })
    assert.equal(b.pendingApprovals().length, 1)
    b.decide(request.id, true)
    assert.equal(b.pendingApprovals().length, 0)
    b.close()
  } finally { cleanup() }
})

test('spending is attributed and can be totalled', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const mgr = b.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const dev = b.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    const task = b.assign({ by: mgr.id, to: dev.id, goal: 'x' })
    b.recordSpend({ floor: dev.id, task: task.id, provider: 'ollama', model: 'q', inputTokens: 100, outputTokens: 40 })
    b.recordSpend({ floor: dev.id, task: task.id, provider: 'ollama', model: 'q', inputTokens: 50, outputTokens: 60 })
    assert.equal(b.spentOnTask(task.id), 100)
    assert.equal(b.spentSince('1970-01-01T00:00:00.000Z'), 100)
    assert.equal(b.spentSince('2999-01-01T00:00:00.000Z'), 0, 'nothing spent in the future')
    b.close()
  } finally { cleanup() }
})

test('the archives find a fact by keyword and count the recall', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const kept = b.remember({ scope: 'building', layer: 'semantic', text: 'The deploy target is Fly, not Vercel.' })
    b.remember({ scope: 'building', layer: 'episodic', text: 'Rewrote the rowing results table.' })

    const hits = b.recallByKeyword('deploy target')
    assert.equal(hits.length, 1)
    assert.equal(hits[0]!.id, kept.id)

    b.markRecalled([kept.id])
    assert.equal(b.recallByKeyword('deploy')[0]!.useCount, 1, 'recall is use')
    assert.equal(b.recallByKeyword('  ').length, 0, 'an empty query finds nothing rather than everything')
    b.close()
  } finally { cleanup() }
})

test('one floor cannot recall another floor private memory', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const a = b.hire({ role: 'coder', name: 'A', charter: 'x', posting: POSTING })
    const c = b.hire({ role: 'writer', name: 'C', charter: 'x', posting: POSTING })
    b.remember({ scope: 'floor', layer: 'semantic', floor: a.id, text: 'A private note about kestrels.' })

    assert.equal(b.recallByKeyword('kestrels', { floor: a.id }).length, 1, 'its owner can read it')
    assert.equal(b.recallByKeyword('kestrels', { floor: c.id }).length, 0, 'a colleague cannot')
    b.close()
  } finally { cleanup() }
})

test('expired memory is not recalled and pinned memory is always to hand', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    b.remember({ scope: 'building', layer: 'semantic', text: 'A stale fact about pricing.', expiresAt: '2000-01-01T00:00:00.000Z' })
    const live = b.remember({ scope: 'building', layer: 'semantic', text: 'A pinned fact about pricing.', pinned: true })
    assert.equal(b.recallByKeyword('pricing').length, 1, 'the expired one is gone')
    assert.equal(b.pinned(null).map((m) => m.id).includes(live.id), true)
    b.close()
  } finally { cleanup() }
})

test('an approval carries what granting it does, not just a sentence about it', () => {
  // An approval that records only prose cannot be acted on: somebody has to
  // re-type what was agreed to, and that is where agreements get lost.
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const hr = b.hire({ role: 'hiring', name: 'Wren', charter: 'x', posting: POSTING })
    const request = b.requestApproval({
      kind: 'hire',
      by: hr.id,
      intent: 'Hire Pitch as marketer. The launch copy keeps arriving and nobody here writes it.',
      payload: { do: 'hire', role: 'marketer', name: 'Pitch', charter: '' },
    })

    const stored = b.approval(request.id)!
    assert.equal(stored.payload?.do, 'hire')
    assert.equal(stored.payload?.do === 'hire' && stored.payload.role, 'marketer')
    assert.equal(stored.state, 'pending')

    b.decide(request.id, true)
    assert.equal(b.approval(request.id)!.state, 'granted')
    assert.ok(b.approval(request.id)!.decidedAt)
    b.close()
  } finally { cleanup() }
})

test('an approval without a payload is still a valid record', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const mgr = b.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const request = b.requestApproval({ kind: 'publish', by: mgr.id, intent: 'Publish the launch post' })
    assert.equal(b.approval(request.id)!.payload, null)
    b.close()
  } finally { cleanup() }
})

test('the curator works below ground and does not make the building taller', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    b.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    b.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    assert.equal(b.headcount(), 2)
    b.hire({ role: 'curator', name: 'Fen', charter: 'x', posting: POSTING })
    assert.equal(b.headcount(), 2, 'a building should not appear to grow because it started tidying up')
    assert.equal(b.staff().length, 3, 'but the curator is still staff')
    b.close()
  } finally { cleanup() }
})

test('a floor can be moved to a different model without being rehired', () => {
  const { dir, cleanup } = scratch()
  try {
    const b = openBuilding(dir)
    const dev = b.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    b.repost(dev.id, { provider: 'openai', model: 'gpt-5', engine: 'direct' })
    const moved = b.floor(dev.id)!
    assert.equal(moved.posting.provider, 'openai')
    assert.equal(moved.posting.model, 'gpt-5')
    assert.equal(moved.name, 'Nib', 'they are the same person')
    assert.equal(moved.hiredAt, dev.hiredAt, 'and they have been here just as long')
    b.close()
  } finally { cleanup() }
})
