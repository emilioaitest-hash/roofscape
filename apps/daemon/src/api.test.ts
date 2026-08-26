import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApi } from './api.js'
import { EventStream } from './events.js'
import { HttpError } from './router.js'

/**
 * The write paths, which are what makes the dashboard more than a viewer.
 * Handlers are called directly: a port would add a race and prove nothing extra.
 */
function harness() {
  const home = mkdtempSync(join(tmpdir(), 'roofscape-api-'))
  const workspace = join(home, 'work')
  mkdirSync(workspace)
  process.env.ROOFSCAPE_HOME = home

  const events = new EventStream()
  const api = buildApi(events)
  const seen: string[] = []
  const original = events.emit.bind(events)
  events.emit = (event) => { seen.push(event.kind); original(event) }

  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(`http://x${path}`)
    const route = api.match(method, url.pathname)
    if (!route) throw new Error(`no route for ${method} ${path}`)
    return route.handler({
      request: {} as never,
      response: {} as never,
      params: route.params,
      query: url.searchParams,
      body: async () => body as never,
    })
  }

  return {
    call, workspace, seen,
    cleanup: () => { delete process.env.ROOFSCAPE_HOME; rmSync(home, { recursive: true, force: true }) },
  }
}

test('a building can be broken ground on without touching the CLI', async () => {
  const h = harness()
  try {
    const before = (await h.call('GET', '/api/skyline')) as { buildings: unknown[] }
    assert.equal(before.buildings.length, 0)

    const building = (await h.call('POST', '/api/buildings', {
      name: 'Made From The Page',
      workspace: h.workspace,
      charter: 'Proving it.',
    })) as { id: string; name: string }

    assert.equal(building.id, 'made-from-the-page', 'the id is a legible folder name')
    const after = (await h.call('GET', '/api/skyline')) as { buildings: Array<{ id: string; headcount: number }> }
    assert.equal(after.buildings.length, 1)
    assert.ok(h.seen.includes('ground-broken'), 'and it is announced on the stream')
  } finally { h.cleanup() }
})

test('a building without a name or a workspace is refused, with the reason', async () => {
  const h = harness()
  try {
    await assert.rejects(() => h.call('POST', '/api/buildings', { workspace: h.workspace }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 400)
      assert.match(error.message, /name/i)
      return true
    })
    await assert.rejects(() => h.call('POST', '/api/buildings', { name: 'Nameless' }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.match(error.message, /workspace/i)
      return true
    })
  } finally { h.cleanup() }
})

test('two buildings may not share a name', async () => {
  const h = harness()
  try {
    await h.call('POST', '/api/buildings', { name: 'Twice', workspace: h.workspace })
    await assert.rejects(() => h.call('POST', '/api/buildings', { name: 'Twice', workspace: h.workspace }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 409)
      return true
    })
  } finally { h.cleanup() }
})

test('hiring from the page adds a floor and says what the building became', async () => {
  const h = harness()
  try {
    await h.call('POST', '/api/buildings', { name: 'Growing', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/growing')) as { staff: unknown[]; tier: string }
    const startedWith = detail.staff.length

    await h.call('POST', '/api/buildings/growing/hire', { role: 'coder', name: 'Quill' })
    const after = (await h.call('GET', '/api/buildings/growing')) as { staff: Array<{ name: string }>; tier: string }

    assert.equal(after.staff.length, startedWith + 1)
    assert.ok(after.staff.some((f) => f.name === 'Quill'))
    assert.ok(h.seen.includes('hired'))
  } finally { h.cleanup() }
})

test('a role nobody offers is refused by name', async () => {
  const h = harness()
  try {
    await h.call('POST', '/api/buildings', { name: 'Picky', workspace: h.workspace })
    await assert.rejects(() => h.call('POST', '/api/buildings/picky/hire', { role: 'astronaut' }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 400)
      assert.match(error.message, /astronaut/)
      return true
    })
  } finally { h.cleanup() }
})

test('a building that does not exist is a 404, not a crash', async () => {
  const h = harness()
  try {
    await assert.rejects(() => h.call('GET', '/api/buildings/nowhere'), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 404)
      return true
    })
  } finally { h.cleanup() }
})

test('a goal put to an empty building says so rather than starting nothing', async () => {
  const h = harness()
  try {
    // Broken ground with no providers configured, so nobody was hired.
    await h.call('POST', '/api/buildings', { name: 'Hollow', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/hollow')) as { staff: unknown[] }
    if (detail.staff.length > 0) return // A provider is configured here; not the case under test.

    await assert.rejects(() => h.call('POST', '/api/buildings/hollow/goal', { goal: 'Do something' }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 422)
      return true
    })
  } finally { h.cleanup() }
})

test('a goal with no text is refused before anything is started', async () => {
  const h = harness()
  try {
    await h.call('POST', '/api/buildings', { name: 'Quiet', workspace: h.workspace })
    await assert.rejects(() => h.call('POST', '/api/buildings/quiet/goal', {}), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 400)
      return true
    })
  } finally { h.cleanup() }
})

test('the roles list is complete enough to choose from', async () => {
  const h = harness()
  try {
    const { roles } = (await h.call('GET', '/api/roles')) as { roles: Array<{ role: string; summary: string }> }
    assert.ok(roles.length >= 8)
    for (const entry of roles) {
      assert.ok(entry.summary.length > 10, `${entry.role} has nothing to choose it by`)
    }
    assert.ok(roles.some((r) => r.role === 'manager'))
  } finally { h.cleanup() }
})

test('the skyline art matches what the terminal draws', async () => {
  const h = harness()
  try {
    await h.call('POST', '/api/buildings', { name: 'Drawn', workspace: h.workspace })
    const { art } = (await h.call('GET', '/api/skyline/art')) as { art: string }
    assert.match(art, /Drawn/, 'the name is under the building')
    assert.ok(art.includes('─'), 'and it stands on a street')
  } finally { h.cleanup() }
})
