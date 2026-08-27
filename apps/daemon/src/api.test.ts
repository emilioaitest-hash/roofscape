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
function harness(options: { withProvider?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'roofscape-api-'))
  const workspace = join(home, 'work')
  mkdirSync(workspace)
  process.env.ROOFSCAPE_HOME = home

  // Whether a provider exists must be stated, not inherited. These tests passed
  // on the author's machine because Claude Code happened to be installed, and
  // failed on a clean runner where nothing was — which is the whole reason a
  // clean runner is worth having.
  const hadKey = process.env.OPENAI_API_KEY
  const hadClaude = process.env.ROOFSCAPE_CLAUDE_BIN
  if (options.withProvider) {
    process.env.OPENAI_API_KEY = 'sk-for-tests'
  } else {
    delete process.env.OPENAI_API_KEY
    // Including an installed Claude Code, which is itself a provider.
    process.env.ROOFSCAPE_CLAUDE_BIN = 'none'
  }

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
    cleanup: () => {
      delete process.env.ROOFSCAPE_HOME
      if (hadKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = hadKey
      if (hadClaude === undefined) delete process.env.ROOFSCAPE_CLAUDE_BIN
      else process.env.ROOFSCAPE_CLAUDE_BIN = hadClaude
      rmSync(home, { recursive: true, force: true })
    },
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
  const h = harness({ withProvider: true })
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
  const h = harness({ withProvider: true })
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
  // Deliberately without a provider, so nobody is hired at ground-breaking and
  // the building really is empty.
  const h = harness({ withProvider: false })
  try {
    await h.call('POST', '/api/buildings', { name: 'Hollow', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/hollow')) as { staff: unknown[] }
    assert.equal(detail.staff.length, 0, 'no provider means no founding staff')

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

test('a task left mid-flight by a crash goes back in the queue', async () => {
  // Nothing un-marks a working task if the process dies. Left alone they sit in
  // working for ever: never picked up, never reported, and counted as busy on
  // the skyline, so the building looks permanently mid-job.
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Interrupted', workspace: h.workspace })
    const before = (await h.call('GET', '/api/buildings/interrupted')) as {
      staff: Array<{ id: string; role: string }>
    }
    const manager = before.staff.find((f) => f.role === 'manager')!
    const coder = before.staff.find((f) => f.role === 'coder')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('interrupted' as never)
    const midFlight = store.assign({ by: manager.id as never, to: coder.id as never, goal: 'Was interrupted' })
    const reviewed = store.assign({ by: manager.id as never, to: coder.id as never, goal: 'Was finished' })
    store.setTaskState(midFlight.id, 'working')
    store.settle(reviewed.id, 'awaiting-review', { summary: 'done', artifacts: [], tokensSpent: 1 })
    store.close()

    const { recoverInterruptedWork } = await import('./recover.js')
    assert.equal(recoverInterruptedWork(), 1, 'one task was stranded')

    const after = BuildingStore.open('interrupted' as never)
    try {
      assert.equal(after.task(midFlight.id)!.state, 'queued', 'the work was asked for and was not done')
      assert.equal(after.task(reviewed.id)!.state, 'awaiting-review', 'finished work is left alone — it exists')
      assert.equal(recoverInterruptedWork(), 0, 'and running it again finds nothing')
    } finally {
      after.close()
    }
  } finally { h.cleanup() }
})

test('what a crash left behind is reported in a sentence, for one task and for several', async () => {
  /*
   * Pluralising the noun and leaving the verb alone produced "1 task were
   * interrupted and have been put back in the queue" — which is the very first
   * line anybody reads after their machine died mid-job, and the only place in
   * the product where the count is nearly always one.
   */
  const h = harness({ withProvider: true })
  try {
    const { BuildingStore } = await import('@app/core')
    const { recoverInterruptedWork } = await import('./recover.js')

    const said: string[] = []
    const listener = { emit: (event: { detail?: string }) => { if (event.detail) said.push(event.detail) } }

    const strand = async (name: string, howMany: number) => {
      await h.call('POST', '/api/buildings', { name, workspace: h.workspace })
      const view = (await h.call('GET', `/api/buildings/${name.toLowerCase()}`)) as {
        staff: Array<{ id: string; role: string }>
      }
      const manager = view.staff.find((f) => f.role === 'manager')!
      const coder = view.staff.find((f) => f.role === 'coder')!
      const store = BuildingStore.open(name.toLowerCase() as never)
      for (let i = 0; i < howMany; i++) {
        const task = store.assign({ by: manager.id as never, to: coder.id as never, goal: `Job ${i}` })
        store.setTaskState(task.id, 'working')
      }
      store.close()
    }

    await strand('Alone', 1)
    recoverInterruptedWork(listener as never)
    assert.equal(said.length, 1)
    assert.match(said[0]!, /^One task was interrupted and is back in the queue\.$/)

    said.length = 0
    await strand('Several', 3)
    recoverInterruptedWork(listener as never)
    assert.equal(said.length, 1)
    assert.match(said[0]!, /^3 tasks were interrupted and are back in the queue\.$/)
  } finally { h.cleanup() }
})

test('a building at its monthly ceiling is refused, not told the work started', async () => {
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Skint', workspace: h.workspace })

    const { SkylineStore, BuildingStore } = await import('@app/core')
    const sky = SkylineStore.open()
    sky.setBudget('skint' as never, { monthlyTokens: 100, perTaskTokens: 50 })
    sky.close()

    const store = BuildingStore.open('skint' as never)
    store.recordSpend({ provider: 'openai', model: 'x', inputTokens: 0, outputTokens: 500 })
    store.close()

    await assert.rejects(() => h.call('POST', '/api/buildings/skint/goal', { goal: 'Spend more' }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 422)
      assert.match(error.message, /this month/)
      return true
    })
  } finally { h.cleanup() }
})

test('a building made from the page is founded exactly as one made from the CLI', async () => {
  // The endpoint had its own copy of the founding roles and kept hiring a
  // hiring manager long after the CLI stopped, so buildings made from the page
  // had nobody who could be given the work. One list, or they drift.
  const h = harness({ withProvider: true })
  try {
    const { FOUNDING_ROLES } = await import('@app/core')
    await h.call('POST', '/api/buildings', { name: 'Founded', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/founded')) as { staff: Array<{ role: string }> }

    assert.deepEqual(
      detail.staff.map((f) => f.role).sort(),
      [...FOUNDING_ROLES].sort(),
      'the page founds a building with the same crew the terminal does',
    )
  } finally { h.cleanup() }
})

test('a workspace that is not there is refused, whichever door you came in', async () => {
  // `roofscape ground` has always checked this. The page did not, so a typo
  // made a building that looked right and failed the first time it was given
  // work — with an error about the work rather than about the path.
  const h = harness({ withProvider: true })
  try {
    await assert.rejects(
      () => h.call('POST', '/api/buildings', { name: 'Typo', workspace: join(h.workspace, 'nope') }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 400)
        assert.match(error.message, /No such directory/)
        return true
      },
    )
    const after = (await h.call('GET', '/api/skyline')) as { buildings: unknown[] }
    assert.equal(after.buildings.length, 0, 'nothing was created on the way to failing')
  } finally { h.cleanup() }
})

test('breaking ground with no provider says why nobody was taken on', async () => {
  // A building founded empty is a dead end, and the reason is never in the
  // building — it is that there was nothing to post a manager to.
  const h = harness()
  try {
    const building = (await h.call('POST', '/api/buildings', {
      name: 'Unstaffed', workspace: h.workspace,
    })) as { warning?: string }
    assert.match(String(building.warning), /no model provider/i)

    const detail = (await h.call('GET', '/api/buildings/unstaffed')) as { staff: unknown[] }
    assert.equal(detail.staff.length, 0, 'and it really is empty')
  } finally { h.cleanup() }
})

test('the owner can write to a floor, and it lands in that floor’s inbox', async () => {
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Post', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/post')) as { staff: Array<{ id: string; role: string }> }
    const manager = detail.staff.find((f) => f.role === 'manager')!

    await h.call('POST', '/api/buildings/post/mail', { to: manager.id, body: 'Chase the invoices.' })

    const mail = (await h.call('GET', '/api/buildings/post/mail')) as {
      messages: Array<{ body: string; from: { id: string | null }; to: { id: string | null } }>
      unread: { byFloor: Record<string, number>; owner: number }
    }
    assert.equal(mail.messages.length, 1)
    assert.equal(mail.messages[0]!.body, 'Chase the invoices.')
    assert.equal(mail.messages[0]!.from.id, null, 'the owner is not a floor')
    assert.equal(mail.messages[0]!.to.id, manager.id)
    assert.equal(mail.unread.byFloor[manager.id], 1, 'it is unread post, not just a record')
    assert.equal(mail.unread.owner, 0, 'and it is not in the owner’s own inbox')
  } finally { h.cleanup() }
})

test('an empty message is refused rather than filed', async () => {
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Quiet', workspace: h.workspace })
    await assert.rejects(
      () => h.call('POST', '/api/buildings/quiet/mail', { body: '   ' }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 400)
        return true
      },
    )
  } finally { h.cleanup() }
})

test('the bridge never hands back the token it was given', async () => {
  const h = harness()
  try {
    await h.call('POST', '/api/bridge', { token: 'a-secret-bot-token-abcd', tokenKind: 'literal' })
    const bridge = (await h.call('GET', '/api/bridge')) as { token: string; connected: boolean }

    assert.equal(bridge.connected, true, 'it knows a token is set')
    assert.ok(!bridge.token.includes('a-secret-bot-token'), 'but does not repeat it')
    assert.match(bridge.token, /abcd$/, 'only enough of it to recognise which one')
  } finally { h.cleanup() }
})
