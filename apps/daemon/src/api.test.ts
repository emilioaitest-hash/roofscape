import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApi, askOwner } from './api.js'
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
    call, workspace, seen, events,
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
    // With somebody who reads work, so that finished work is genuinely waiting
    // for a reader rather than for nobody — which recovery now settles.
    await h.call('POST', '/api/buildings/interrupted/hire', { role: 'reviewer' })
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

test('a curator is staff and is not a storey, and nothing says otherwise', async () => {
  /*
   * `headcount()` deliberately leaves the curator out: it works in the archives,
   * below ground, and a building should not appear to grow because it started
   * tidying up. Every nameplate then called that number "on staff" — so a
   * six-floor building with a curator in it had seven people and a sign saying
   * six, and the concierge, given both figures by two different tools, said so
   * and could not tell which was right.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Tidy', workspace: h.workspace })
    const before = (await h.call('GET', '/api/buildings/tidy')) as {
      headcount: number
      staff: Array<{ role: string }>
    }
    assert.equal(before.headcount, before.staff.length, 'no curator yet, so the two agree')

    await h.call('POST', '/api/buildings/tidy/hire', { role: 'curator' })
    const after = (await h.call('GET', '/api/buildings/tidy')) as {
      headcount: number
      staff: Array<{ role: string }>
    }
    assert.equal(after.staff.length, before.staff.length + 1, 'the curator was taken on')
    assert.equal(after.headcount, before.headcount, 'and the building did not grow a storey for it')

    // The drawn nameplate carries the floor count, so it must not be worded as
    // a number of people — that is the sentence that was wrong.
    const city = (await h.call('GET', '/api/skyline/city')) as {
      buildings: Array<{ id: string; headcount: number; note: string }>
      svg: string
    }
    const drawn = city.buildings.find((b) => b.id === 'tidy')!
    assert.equal(drawn.headcount, after.headcount)
    assert.match(drawn.note, /^\d+ floors?$/, `the nameplate reads "${drawn.note}"`)
    assert.ok(!city.svg.includes('on staff'), 'the drawing still calls its floor count a headcount')
  } finally { h.cleanup() }
})

test('a building can be taken off the skyline and put back on it', async () => {
  /*
   * The store could mothball a building from the first commit and nothing ever
   * called it, so breaking ground was one typo away from a building nobody
   * could remove without editing the database. It must stay a shutter and
   * never become a delete: what comes back has to be the same building.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Mistake', workspace: h.workspace })
    await h.call('POST', '/api/buildings', { name: 'Keeper', workspace: h.workspace })
    await h.call('POST', '/api/buildings/mistake/hire', { role: 'reviewer' })

    const before = (await h.call('GET', '/api/skyline/city')) as {
      buildings: Array<{ id: string; headcount: number }>
      boardedUp: Array<{ id: string }>
    }
    assert.deepEqual(before.buildings.map((b) => b.id).sort(), ['keeper', 'mistake'])
    assert.deepEqual(before.boardedUp, [], 'nothing was boarded up yet')
    const staffed = before.buildings.find((b) => b.id === 'mistake')!.headcount

    await h.call('POST', '/api/buildings/mistake/close')
    const after = (await h.call('GET', '/api/skyline/city')) as {
      buildings: Array<{ id: string }>
      boardedUp: Array<{ id: string; name: string }>
    }
    assert.deepEqual(after.buildings.map((b) => b.id), ['keeper'], 'it is off the skyline')
    assert.deepEqual(after.boardedUp.map((b) => b.name), ['Mistake'], 'and offered back')

    // Its own screen still resolves while it is boarded up, so a link or a
    // bookmark to it is not a 404 for something that still exists.
    const inside = (await h.call('GET', '/api/buildings/mistake')) as { headcount: number }
    assert.equal(inside.headcount, staffed, 'boarding it up cost it a floor')

    await h.call('POST', '/api/buildings/mistake/reopen')
    const back = (await h.call('GET', '/api/skyline/city')) as {
      buildings: Array<{ id: string; headcount: number }>
      boardedUp: Array<{ id: string }>
    }
    assert.deepEqual(back.buildings.map((b) => b.id).sort(), ['keeper', 'mistake'])
    assert.deepEqual(back.boardedUp, [])
    assert.equal(
      back.buildings.find((b) => b.id === 'mistake')!.headcount, staffed,
      'it came back a different building from the one that left',
    )
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

test('finished work waiting for a reader who does not exist is let through', async () => {
  /*
   * The state every installation is already full of: nothing ever reached
   * `done` unless the building had a reviewer, and a building is founded with a
   * manager and a coder. So every success sat in `awaiting-review` for good,
   * counted as open and lighting a window that could never go out.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Unread', workspace: h.workspace })
    const view = (await h.call('GET', '/api/buildings/unread')) as { staff: Array<{ id: string; role: string }> }
    const manager = view.staff.find((f) => f.role === 'manager')!
    const coder = view.staff.find((f) => f.role === 'coder')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('unread' as never)
    const stuck = store.assign({ by: manager.id as never, to: coder.id as never, goal: 'Was finished long ago' })
    store.settle(stuck.id, 'awaiting-review', { summary: 'Done it.', artifacts: [], tokensSpent: 10 })
    assert.equal(store.busyFloors(), 1, 'and until now it kept a window lit')
    store.close()

    const { recoverInterruptedWork } = await import('./recover.js')
    assert.equal(recoverInterruptedWork(h.events), 1)
    assert.ok(h.seen.includes('settled'), 'and it says so rather than tidying up quietly')

    const after = BuildingStore.open('unread' as never)
    try {
      assert.equal(after.task(stuck.id)!.state, 'done')
      assert.equal(after.busyFloors(), 0, 'the window has gone out')
      assert.equal(recoverInterruptedWork(), 0, 'and running it again finds nothing')
    } finally { after.close() }
  } finally { h.cleanup() }
})

/** Let anything already queued on the microtask loop actually run. */
const settleQueue = () => new Promise((done) => setImmediate(done))

test('a request the owner has not seen is not refused before they see it', async () => {
  /*
   * The daemon recorded a docket and refused it in the same breath, so every
   * ask resolved false before the flag on the roof could even be drawn. The
   * agent was told no and moved on; deciding it afterwards resumed nothing.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Desk', workspace: h.workspace })
    const { SkylineStore, BuildingStore } = await import('@app/core')
    const sky = SkylineStore.open()
    const building = sky.get('desk' as never)!
    sky.close()

    const store = BuildingStore.open('desk' as never)
    try {
      let settled: boolean | null = null
      const answer = askOwner(h.events, building, store, false)('publish', 'Publish the results page')
        .then((granted) => { settled = granted; return granted })

      await settleQueue()
      assert.equal(settled, null, 'the run is still standing at the desk')

      const waiting = (await h.call('GET', '/api/approvals')) as {
        pending: Array<{ id: string; intent: string; waiting: boolean }>
      }
      assert.equal(waiting.pending.length, 1)
      assert.equal(waiting.pending[0]!.intent, 'Publish the results page')
      assert.equal(waiting.pending[0]!.waiting, true, 'and the desk says somebody is waiting on the answer')

      const decided = (await h.call('POST', `/api/approvals/${waiting.pending[0]!.id}`, { granted: true })) as {
        decided: boolean; resumed: boolean
      }
      assert.equal(decided.resumed, true, 'deciding it resumes the run rather than only recording it')
      assert.equal(await answer, true, 'and the agent is told what the owner actually said')
    } finally {
      store.close()
    }
  } finally { h.cleanup() }
})

test('silence at the desk is a refusal, and says so', async () => {
  // An approval that waits for ever holds the building; one that assumes yes is
  // not an approval. It refuses, and the docket is settled rather than left
  // standing over a question nobody is waiting on any more.
  const h = harness({ withProvider: true })
  const had = process.env.ROOFSCAPE_ASK_TIMEOUT_MS
  process.env.ROOFSCAPE_ASK_TIMEOUT_MS = '20'
  try {
    await h.call('POST', '/api/buildings', { name: 'Patient', workspace: h.workspace })
    const { SkylineStore, BuildingStore } = await import('@app/core')
    const sky = SkylineStore.open()
    const building = sky.get('patient' as never)!
    sky.close()

    const store = BuildingStore.open('patient' as never)
    try {
      const granted = await askOwner(h.events, building, store, false)('deploy', 'Deploy to production')
      assert.equal(granted, false)
      assert.equal(store.pendingApprovals().length, 0, 'the docket is decided, not left hanging')
      assert.ok(h.seen.includes('ask-timed-out'), 'and the stream says why it was refused')
    } finally {
      store.close()
    }
  } finally {
    if (had === undefined) delete process.env.ROOFSCAPE_ASK_TIMEOUT_MS
    else process.env.ROOFSCAPE_ASK_TIMEOUT_MS = had
    h.cleanup()
  }
})

test('a docket inside a boarded-up building can still be answered', async () => {
  // Both approval routes read the skyline, which leaves boarded-up buildings
  // off it — so boarding one up made its pending dockets un-decidable, for the
  // one action the product describes as safe and reversible.
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Shuttered', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/shuttered')) as { staff: Array<{ id: string; role: string }> }
    const manager = detail.staff.find((f) => f.role === 'manager')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('shuttered' as never)
    const approval = store.requestApproval({ kind: 'publish', by: manager.id as never, intent: 'Send the newsletter' })
    store.close()

    await h.call('POST', '/api/buildings/shuttered/close')

    const desk = (await h.call('GET', '/api/approvals')) as {
      pending: Array<{ id: string; boardedUp: boolean }>
    }
    assert.equal(desk.pending.length, 1, 'it is still waiting on you')
    assert.equal(desk.pending[0]!.boardedUp, true, 'and the page can say where it is')

    const decided = (await h.call('POST', `/api/approvals/${approval.id}`, { granted: false })) as { decided: boolean }
    assert.equal(decided.decided, true, 'and it can be answered')
  } finally { h.cleanup() }
})

test('a provider can be connected without going anywhere near a terminal', async () => {
  /*
   * There was no POST at all: `putProvider` was reachable only from the CLI,
   * which the desktop app does not ship. The Models dialog was a read-only list
   * of remedies the owner had no way to carry out, under a promise that there
   * is nothing to install first.
   */
  const h = harness()
  try {
    const { SkylineStore } = await import('@app/core')

    const added = (await h.call('POST', '/api/providers', { name: 'openai', key: 'sk-typed-into-the-page' })) as {
      ok: boolean; status: { ok: boolean }
    }
    assert.equal(added.ok, true)

    const sky = SkylineStore.open()
    try {
      assert.equal(sky.credentialFor('openai'), 'sk-typed-into-the-page', 'and the key is where the runtime looks for it')
    } finally { sky.close() }

    // Naming a variable is preferred, and keeps the secret out of the database.
    await h.call('POST', '/api/providers', { name: 'openai', env: 'OPENAI_API_KEY' })
    const after = SkylineStore.open()
    try {
      const record = after.providers().find((p) => p.name === 'openai')!
      assert.equal(record.credentialKind, 'env')
      assert.equal(record.credential, 'OPENAI_API_KEY', 'the name of the variable, never its value')
    } finally { after.close() }

    const gone = (await h.call('POST', '/api/providers', { name: 'openai', remove: true })) as { forgotten: boolean }
    assert.equal(gone.forgotten, true)
  } finally { h.cleanup() }
})

test('a provider nobody can reach is refused with the reason, not saved as a stub', async () => {
  const h = harness()
  try {
    await assert.rejects(() => h.call('POST', '/api/providers', { name: 'nowhere' }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 400)
      assert.match(error.message, /nowhere/)
      return true
    })

    const hadKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      await assert.rejects(() => h.call('POST', '/api/providers', { name: 'anthropic' }), (error: unknown) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 422)
        assert.match(error.message, /ANTHROPIC_API_KEY/, 'and it names the variable that would do it')
        return true
      })
    } finally {
      if (hadKey !== undefined) process.env.ANTHROPIC_API_KEY = hadKey
    }
  } finally { h.cleanup() }
})

test('somebody can leave, and the building gets shorter', async () => {
  /*
   * `vacate` had no caller anywhere — no route, no command — so a building's
   * height only ever went up and a mis-hire was permanently built into the
   * skyline. Height is headcount, and it needs a way down as well as up.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Shrink', workspace: h.workspace })
    const before = (await h.call('GET', '/api/buildings/shrink')) as {
      headcount: number; staff: Array<{ id: string; role: string }>
    }
    const manager = before.staff.find((f) => f.role === 'manager')!
    const coder = before.staff.find((f) => f.role === 'coder')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('shrink' as never)
    const held = store.assign({ by: manager.id as never, to: coder.id as never, goal: 'Half-done thing' })
    store.close()

    const left = (await h.call('POST', `/api/buildings/shrink/floors/${coder.id}/vacate`)) as {
      headcount: number; handedBack: number; warning: string | null
    }
    assert.equal(left.headcount, before.headcount - 1, 'the building lost a storey')
    assert.equal(left.handedBack, 1, 'and what they were holding came back to the desk')
    assert.equal(left.warning, null, 'there is still a manager')
    assert.ok(h.seen.includes('vacated'))

    const after = (await h.call('GET', '/api/buildings/shrink')) as { staff: Array<{ id: string }> }
    assert.ok(!after.staff.some((f) => f.id === coder.id), 'they are off the staff list')

    const check = BuildingStore.open('shrink' as never)
    try {
      assert.equal(check.task(held.id)!.state, 'escalated', 'their work is on your desk, not assigned to a ghost')
      assert.equal(check.staff({ includeVacated: true }).some((f) => f.id === coder.id), true, 'nothing was deleted')
    } finally { check.close() }

    const alone = (await h.call('POST', `/api/buildings/shrink/floors/${manager.id}/vacate`)) as { warning: string | null }
    assert.match(String(alone.warning), /no manager/i, 'and losing the last manager is said out loud')
  } finally { h.cleanup() }
})

test('the owner can be given a name, and the buildings use it', async () => {
  // `setOwner` was unreachable, so the name was always empty and the mailroom
  // called everybody "You".
  const h = harness()
  try {
    const owner = (await h.call('POST', '/api/owner', { name: 'Ada' })) as { name: string }
    assert.equal(owner.name, 'Ada')

    const sky = (await h.call('GET', '/api/skyline')) as { owner: { name: string } }
    assert.equal(sky.owner.name, 'Ada')
  } finally { h.cleanup() }
})

test('the home screen always names the one next thing to do', async () => {
  /*
   * Where the app was actually abandoned: one building with nobody in it fell
   * through to the ordinary strip, four zeros and "click a building". Nothing
   * anywhere said hire somebody, which is the only thing that makes a building
   * do anything. First-run is a state machine, not a boolean.
   */
  const h = harness({ withProvider: true })
  try {
    const bare = (await h.call('GET', '/api/skyline/city')) as { next: { do: string; say: string } }
    assert.equal(bare.next.do, 'break-ground')

    await h.call('POST', '/api/buildings', { name: 'Nextly', workspace: h.workspace })
    const staffed = (await h.call('GET', '/api/skyline/city')) as { next: { do: string; say: string } }
    assert.equal(staffed.next.do, 'set-goal', 'staffed and never asked for anything')
    assert.match(staffed.next.say, /Nextly/)

    const detail = (await h.call('GET', '/api/buildings/nextly')) as { staff: Array<{ id: string }> }
    for (const floor of detail.staff) {
      await h.call('POST', `/api/buildings/nextly/floors/${floor.id}/vacate`)
    }
    const empty = (await h.call('GET', '/api/skyline/city')) as { next: { do: string; say: string } }
    assert.equal(empty.next.do, 'hire', 'a building with nobody in it asks for somebody')
    assert.match(empty.next.say, /grows a storey/)
  } finally { h.cleanup() }
})

test('a request to run a command reaches the desk as itself, said in words', async () => {
  /*
   * There were two lists of what a docket can be about: six kinds on the
   * approval, and the same six plus `shell` — much the commonest — on the
   * escalation. They met at a cast to `'publish'`, which silenced the compiler
   * and let `shell` into the database regardless, so the owner's desk showed
   * three requests all labelled SHELL and all captioned with the one sentence
   * the page had for a kind it did not know.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Terminal', workspace: h.workspace })
    const { SkylineStore, BuildingStore } = await import('@app/core')
    const sky = SkylineStore.open()
    const building = sky.get('terminal' as never)!
    sky.close()

    const store = BuildingStore.open('terminal' as never)
    try {
      // Exactly how the shell tool asks: the kind, and the command inside the
      // sentence. Nothing else in the product phrases it.
      const answer = askOwner(h.events, building, store, false)('shell', 'Run: git push --force origin main')
      await settleQueue()

      assert.equal(store.pendingApprovals()[0]!.kind, 'shell', 'the kind stored is the one that was asked')

      const desk = (await h.call('GET', '/api/approvals')) as {
        said: Record<string, string>
        pending: Array<{ id: string; kind: string; said: string; command: string | null }>
      }
      const docket = desk.pending[0]!
      assert.equal(docket.kind, 'shell')
      assert.equal(docket.said, 'runs a command', 'the kind is said rather than printed')
      assert.equal(docket.command, 'git push --force origin main', 'and the owner can read what they are deciding')

      // The table itself goes out, so no screen has to keep its own — which is
      // how the page came to have a phrase for every kind except this one.
      for (const [kind, said] of Object.entries(desk.said)) {
        assert.notEqual(said, kind, `${kind} is printed rather than said`)
      }
      assert.ok(desk.said.shell, 'including the commonest kind of all')

      await h.call('POST', `/api/approvals/${docket.id}`, { granted: false })
      assert.equal(await answer, false, 'and the run standing at the desk is told')
    } finally {
      store.close()
    }
  } finally { h.cleanup() }
})

test('a docket that is not about a command carries no command', async () => {
  // The command comes out of the intent because that is where the tool puts it.
  // Anything else keeps its sentence and gets no empty box under it.
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Postal', workspace: h.workspace })
    const detail = (await h.call('GET', '/api/buildings/postal')) as { staff: Array<{ id: string; role: string }> }
    const manager = detail.staff.find((f) => f.role === 'manager')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('postal' as never)
    store.requestApproval({ kind: 'send', by: manager.id as never, intent: 'Email the investors the numbers' })
    store.close()

    const desk = (await h.call('GET', '/api/approvals')) as {
      pending: Array<{ said: string; command: string | null; intent: string }>
    }
    assert.equal(desk.pending[0]!.said, 'goes to somebody outside')
    assert.equal(desk.pending[0]!.command, null)
    assert.equal(desk.pending[0]!.intent, 'Email the investors the numbers', 'the sentence is still the sentence')

    const inside = (await h.call('GET', '/api/buildings/postal')) as {
      approvals: Array<{ said: string; command: string | null }>
    }
    assert.equal(inside.approvals[0]!.said, 'goes to somebody outside', 'the lobby reads the same docket as the street')
  } finally { h.cleanup() }
})

/** A building, a reviewer, and one piece of work that was finished and never read. */
async function strandUnderReview(h: ReturnType<typeof harness>, name: string) {
  const id = name.toLowerCase()
  await h.call('POST', '/api/buildings', { name, workspace: h.workspace })
  await h.call('POST', `/api/buildings/${id}/hire`, { role: 'reviewer' })
  const view = (await h.call('GET', `/api/buildings/${id}`)) as { staff: Array<{ id: string; role: string }> }
  const manager = view.staff.find((f) => f.role === 'manager')!
  const coder = view.staff.find((f) => f.role === 'coder')!

  const { BuildingStore } = await import('@app/core')
  const store = BuildingStore.open(id as never)
  const task = store.assign({ by: manager.id as never, to: coder.id as never, goal: 'Was finished, never read' })
  store.settle(task.id, 'awaiting-review', { summary: 'Did the thing.', artifacts: ['branch:roofscape/x'], tokensSpent: 12 })
  store.close()
  return task
}

test('work whose reader never came is left for the owner, not redone and not waved through', async () => {
  /*
   * The one honest gap left from the last round. A review only ever happens
   * inside a run: the work settles to `awaiting-review` and the reviewer is
   * asked in the next breath. A run that dies in between leaves it there for
   * good, counted as open and lighting a window nobody is behind.
   *
   * Queueing it again redoes work that was done and paid for. Marking it `done`
   * claims an acceptance nobody gave. So it is handed to the owner, who is the
   * only reader left, and it says so.
   */
  const h = harness({ withProvider: true })
  try {
    const stranded = await strandUnderReview(h, 'Halfway')
    const { BuildingStore } = await import('@app/core')

    const before = BuildingStore.open('halfway' as never)
    assert.equal(before.busyFloors(), 1, 'until now it kept a window lit')
    before.close()

    const city = (await h.call('GET', '/api/skyline/city')) as {
      buildings: Array<{ id: string; unread: number }>
      next: { do: string; say: string; building: string | null }
    }
    assert.equal(city.buildings.find((b) => b.id === 'halfway')!.unread, 1)
    assert.equal(city.next.do, 'read-work', 'the home screen names it as the thing to do')
    assert.match(city.next.say, /Halfway/)
    assert.ok(h.seen.includes('left-unread'), 'and it says so rather than moving work about quietly')

    const after = BuildingStore.open('halfway' as never)
    try {
      const task = after.task(stranded.id)!
      assert.equal(task.state, 'unread', 'not queued again, and not called done')
      assert.equal(task.result!.summary, 'Did the thing.', 'the work itself is untouched')
      assert.equal(after.busyFloors(), 0, 'and the window has gone out')
    } finally { after.close() }

    const inside = (await h.call('GET', '/api/buildings/halfway')) as {
      unread: Array<{ id: string; goal: string }>
      open: Array<{ id: string }>
    }
    assert.equal(inside.unread.length, 1, 'the owner can see it')
    assert.equal(inside.unread[0]!.id, stranded.id)
    assert.ok(!inside.open.some((t) => t.id === stranded.id), 'and the building is not still holding it')

    const read = (await h.call('POST', `/api/tasks/${stranded.id}/read`, { accepted: true })) as {
      read: boolean; state: string; note: string
    }
    assert.equal(read.state, 'done')
    assert.ok(h.seen.includes('work-read'))

    const settled = BuildingStore.open('halfway' as never)
    try {
      assert.equal(settled.task(stranded.id)!.state, 'done', 'and it is done because somebody read it')
    } finally { settled.close() }

    const moved = (await h.call('GET', '/api/skyline/city')) as { next: { do: string } }
    assert.notEqual(moved.next.do, 'read-work', 'the home screen stops asking')
  } finally { h.cleanup() }
})

test('work the owner will not accept is sent back rather than run again', async () => {
  // Two honest answers and no third. Queueing it again would be the building
  // doing work it was never asked for twice; `escalated` is where a reviewer's
  // last word leaves a task, and the owner is the reader here.
  const h = harness({ withProvider: true })
  try {
    const stranded = await strandUnderReview(h, 'Sentback')
    await h.call('GET', '/api/skyline/city')

    const read = (await h.call('POST', `/api/tasks/${stranded.id}/read`, { accepted: false })) as { state: string }
    assert.equal(read.state, 'escalated')

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('sentback' as never)
    try {
      assert.equal(store.task(stranded.id)!.state, 'escalated')
      assert.equal(store.tasks({ state: 'queued' }).length, 0, 'nothing was set running again behind the owner')
    } finally { store.close() }

    await assert.rejects(() => h.call('POST', `/api/tasks/${stranded.id}/read`, { accepted: true }), (error: unknown) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 404, 'and it can only be read once')
      return true
    })
  } finally { h.cleanup() }
})

test('work a live run is still reading is left where it is', async () => {
  /*
   * "Nobody will read it" is read off the claim rather than off a clock: a run
   * holds the building while it works and renews the hold every minute. Without
   * that check, a plain read of the home screen would take work out from under
   * a reviewer who is halfway through it.
   */
  const h = harness({ withProvider: true })
  try {
    const stranded = await strandUnderReview(h, 'Reading')
    const { BuildingStore } = await import('@app/core')

    const held = BuildingStore.open('reading' as never)
    try {
      assert.equal(held.claim('pid:a-run-that-is-still-going').ok, true)

      await h.call('GET', '/api/skyline/city')
      assert.equal(held.task(stranded.id)!.state, 'awaiting-review', 'somebody is still holding the building')

      held.releaseClaim('pid:a-run-that-is-still-going')
      await h.call('GET', '/api/skyline/city')
      assert.equal(held.task(stranded.id)!.state, 'unread', 'and when they let go, it comes to the owner')
    } finally { held.close() }
  } finally { h.cleanup() }
})

test('a building with nobody to read work is left to the rule that lets it through', async () => {
  /*
   * Two rules for one state is how they drift apart. A building with no
   * reviewer never had a reader to lose, and the orchestrator settles its work
   * straight to `done`; recovery says the same for the buildings already full
   * of it. This one only picks up work whose reader exists and never came.
   */
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Readerless', workspace: h.workspace })
    const view = (await h.call('GET', '/api/buildings/readerless')) as { staff: Array<{ id: string; role: string }> }
    const manager = view.staff.find((f) => f.role === 'manager')!
    const coder = view.staff.find((f) => f.role === 'coder')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('readerless' as never)
    const task = store.assign({ by: manager.id as never, to: coder.id as never, goal: 'Nobody here reads' })
    store.settle(task.id, 'awaiting-review', { summary: 'Done.', artifacts: [], tokensSpent: 1 })
    store.close()

    await h.call('GET', '/api/skyline/city')

    const after = BuildingStore.open('readerless' as never)
    try {
      assert.equal(after.task(task.id)!.state, 'awaiting-review', 'not claimed by the wrong rule')
    } finally { after.close() }

    const { recoverInterruptedWork } = await import('./recover.js')
    assert.equal(recoverInterruptedWork(h.events), 1, 'the rule that owns this state still owns it')
  } finally { h.cleanup() }
})

test('the round shows everything waiting on you, dockets and unread work alike', async () => {
  /*
   * Boarded-up buildings included, for the same reason the dockets are: they
   * are off the skyline, which is right for a drawing and wrong for a desk. It
   * is also the only place the handover can happen for a building nobody is
   * drawing — the home screen never looks at one.
   */
  const h = harness({ withProvider: true })
  try {
    const stranded = await strandUnderReview(h, 'Shuttered')
    const detail = (await h.call('GET', '/api/buildings/shuttered')) as { staff: Array<{ id: string; role: string }> }
    const manager = detail.staff.find((f) => f.role === 'manager')!

    const { BuildingStore } = await import('@app/core')
    const store = BuildingStore.open('shuttered' as never)
    store.requestApproval({ kind: 'merge', by: manager.id as never, intent: 'Merge the branch' })
    store.close()

    await h.call('POST', '/api/buildings/shuttered/close')

    const round = (await h.call('GET', '/api/approvals')) as {
      pending: Array<{ said: string; boardedUp: boolean }>
      unread: Array<{ id: string; buildingName: string; goal: string; summary: string | null; boardedUp: boolean }>
    }
    assert.equal(round.pending.length, 1)
    assert.equal(round.pending[0]!.said, 'lands on main')
    assert.equal(round.unread.length, 1, 'and the work nobody read is on the same desk')
    assert.equal(round.unread[0]!.id, stranded.id)
    assert.equal(round.unread[0]!.buildingName, 'Shuttered')
    assert.equal(round.unread[0]!.summary, 'Did the thing.', 'with enough of it to judge by')
    assert.equal(round.unread[0]!.boardedUp, true)

    const read = (await h.call('POST', `/api/tasks/${stranded.id}/read`, { accepted: true })) as { state: string }
    assert.equal(read.state, 'done', 'and it can be answered from there')
  } finally { h.cleanup() }
})

test('a message kind nobody has heard of is filed as a note, not stored raw', async () => {
  // The same laundering, one field over: whatever arrived in the body was cast
  // to a kind and written. A word the rest of the product has never heard of
  // then reaches a screen that has no phrase for it — which is exactly how the
  // approval desk came to show three dockets reading SHELL.
  const h = harness({ withProvider: true })
  try {
    await h.call('POST', '/api/buildings', { name: 'Postbag', workspace: h.workspace })
    const filed = (await h.call('POST', '/api/buildings/postbag/mail', {
      body: 'Have a look at this when you can.',
      kind: 'urgent-shouting',
    })) as { kind: string }
    assert.equal(filed.kind, 'note', 'an unclassified message is a note, which is what it is')

    const kept = (await h.call('POST', '/api/buildings/postbag/mail', {
      body: 'Is the importer done?',
      kind: 'question',
    })) as { kind: string }
    assert.equal(kept.kind, 'question', 'and a real kind is still itself')
  } finally { h.cleanup() }
})
