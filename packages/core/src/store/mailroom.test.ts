import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuildingStore } from './buildingStore.js'
import { asBuildingId } from '../domain/ids.js'
import { OWNER } from '../domain/work.js'
import type { Posting } from '../domain/building.js'

const POSTING: Posting = { provider: 'ollama', model: 'qwen3:4b', engine: 'direct' }

function scratch(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-mail-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const openBuilding = (dir: string) => BuildingStore.open(asBuildingId('test'), join(dir, 'test.db'))

/** A building with a manager and a coder in it. */
function staffed(dir: string) {
  const store = openBuilding(dir)
  const manager = store.hire({ role: 'manager', name: 'Ada', charter: 'run it', posting: POSTING })
  const coder = store.hire({ role: 'coder', name: 'Nib', charter: 'write it', posting: POSTING })
  return { store, manager, coder }
}

test('the owner can be at either end of a message', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager } = staffed(dir)

    const toThem = store.post({ kind: 'note', from: OWNER, to: manager.id, body: 'Chase the invoices.' })
    const toMe = store.post({ kind: 'escalation', from: manager.id, to: OWNER, body: 'Third reminder, or write it off?' })

    assert.equal(toThem.from, null, 'the owner is not a floor')
    assert.equal(toThem.to, manager.id)
    assert.equal(toMe.from, manager.id)
    assert.equal(toMe.to, null)

    // And they survive a round trip through the database as null, not as a
    // floor id that happens to be empty.
    const read = store.conversation()
    assert.equal(read.find((m) => m.id === toThem.id)!.from, null)
    assert.equal(read.find((m) => m.id === toMe.id)!.to, null)
    store.close()
  } finally {
    cleanup()
  }
})

test('the owner being in the post does not make them a floor', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager } = staffed(dir)
    const before = store.headcount()
    store.post({ kind: 'note', from: OWNER, to: manager.id, body: 'hello' })
    assert.equal(store.headcount(), before, 'writing to the building made it taller')
    assert.equal(store.staff().length, 2, 'the owner turned up on the staff list')
    store.close()
  } finally {
    cleanup()
  }
})

test('a conversation reads in the order it was said', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'first' })
    store.post({ kind: 'question', from: coder.id, to: manager.id, body: 'second' })
    store.post({ kind: 'answer', from: manager.id, to: coder.id, body: 'third' })

    const said = store.conversation().map((m) => m.body)
    assert.deepEqual(said, ['first', 'second', 'third'])
    store.close()
  } finally {
    cleanup()
  }
})

test('a limited conversation keeps the recent end, not the old one', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    for (let i = 0; i < 10; i++) {
      store.post({ kind: 'note', from: manager.id, to: coder.id, body: `line ${i}` })
    }
    const tail = store.conversation({ limit: 3 })
    assert.equal(tail.length, 3)
    assert.deepEqual(tail.map((m) => m.body), ['line 7', 'line 8', 'line 9'])
    store.close()
  } finally {
    cleanup()
  }
})

test('a thread gathers everything written in reply, however deep', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    const root = store.post({ kind: 'question', from: manager.id, to: coder.id, body: 'where is it deployed?' })
    const reply = store.post({ kind: 'answer', from: coder.id, to: manager.id, body: 'Fly', inReplyTo: root.id })
    const deeper = store.post({ kind: 'answer', from: manager.id, to: coder.id, body: 'since when?', inReplyTo: reply.id })
    // Somebody else's conversation entirely.
    store.post({ kind: 'note', from: manager.id, to: coder.id, body: 'unrelated' })

    const thread = store.thread(root.id).map((m) => m.id)
    assert.deepEqual(thread, [root.id, reply.id, deeper.id])
    store.close()
  } finally {
    cleanup()
  }
})

test('unread is counted per floor, and the owner is counted separately', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'one' })
    store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'two' })
    store.post({ kind: 'escalation', from: coder.id, to: OWNER, body: 'stuck' })

    const counts = store.unreadCounts()
    assert.equal(counts.byFloor[coder.id], 2)
    assert.equal(counts.owner, 1)
    assert.equal(counts.byFloor[manager.id], undefined, 'the manager was sent nothing')
    store.close()
  } finally {
    cleanup()
  }
})

test('reading your own post does not mark anybody else’s read', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'yours' })
    store.post({ kind: 'escalation', from: coder.id, to: OWNER, body: 'mine' })

    assert.equal(store.markAllRead(OWNER), 1)
    assert.equal(store.ownerInbox().length, 0, 'the owner still has unread post')
    assert.equal(store.inbox(coder.id).length, 1, 'the coder’s post was read on their behalf')
    store.close()
  } finally {
    cleanup()
  }
})

test('an inbox is unread post only, and stops being one once read', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    const first = store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'one' })
    store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'two' })

    assert.equal(store.inbox(coder.id).length, 2)
    store.markRead(first.id)
    assert.equal(store.inbox(coder.id).length, 1)
    // But it is still in the record. Post is not deleted by being read.
    assert.equal(store.conversation().length, 2)
    store.close()
  } finally {
    cleanup()
  }
})

test('the owner’s inbox is the post addressed to nobody in particular', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    store.post({ kind: 'task', from: manager.id, to: coder.id, body: 'not for you' })
    store.post({ kind: 'status', from: manager.id, to: OWNER, body: 'for you' })

    const mine = store.ownerInbox()
    assert.equal(mine.length, 1)
    assert.equal(mine[0]!.body, 'for you')
    store.close()
  } finally {
    cleanup()
  }
})

test('a relay can walk the post without skipping any of it', () => {
  // The mirror used to ask `conversation({since, limit})`, which returns the
  // *newest* rows in the window — so a building writing faster than one batch
  // per tick had its oldest post skipped, and the cursor then advanced past it.
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    for (let i = 0; i < 30; i++) {
      store.post({ kind: 'note', from: manager.id, to: coder.id, body: `line ${i}` })
    }

    // A batch deliberately smaller than the backlog, as a busy building gives.
    let cursor = 0
    const carried: string[] = []
    for (let tick = 0; tick < 20; tick++) {
      const batch = store.messagesSince(cursor, 7)
      if (batch.messages.length === 0) break
      carried.push(...batch.messages.map((m) => m.body))
      cursor = batch.seq
    }

    assert.equal(carried.length, 30, 'post went missing between ticks')
    assert.deepEqual(
      carried,
      Array.from({ length: 30 }, (_, i) => `line ${i}`),
      'post came out in an order nobody wrote it in',
    )
    assert.equal(store.messagesSince(cursor, 40).messages.length, 0, 'and nothing was carried twice')
    store.close()
  } finally {
    cleanup()
  }
})

test('two messages written in the same millisecond both survive the relay', () => {
  // `now()` is millisecond-resolution and a building writes faster than that.
  // A timestamp cursor lost the second of a pair for good and could not order
  // the pair it kept — so a reply could reach Discord before its question.
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    const start = store.latestSeq()

    const first = store.post({ kind: 'question', from: manager.id, to: coder.id, body: 'twin A' })
    const second = store.post({ kind: 'answer', from: coder.id, to: manager.id, body: 'twin B' })
    assert.equal(first.createdAt, second.createdAt, 'the pair this guards against shares a timestamp')

    const carried = store.messagesSince(start, 40).messages.map((m) => m.body)
    assert.deepEqual(carried, ['twin A', 'twin B'])
    store.close()
  } finally {
    cleanup()
  }
})

test('a relay starting up does not replay everything ever said', () => {
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    for (let i = 0; i < 5; i++) {
      store.post({ kind: 'note', from: manager.id, to: coder.id, body: `old ${i}` })
    }

    const from = store.latestSeq()
    store.post({ kind: 'note', from: manager.id, to: coder.id, body: 'new' })

    const carried = store.messagesSince(from, 40).messages.map((m) => m.body)
    assert.deepEqual(carried, ['new'], 'switching the bridge on replayed the archive into a channel')
    store.close()
  } finally {
    cleanup()
  }
})

test('asking for the owner’s side of the correspondence does not return everybody’s', () => {
  // Null is the owner, and a truthiness check on the filter dropped it —
  // silently widening "what did they and I say" to "everything anyone said".
  const { dir, cleanup } = scratch()
  try {
    const { store, manager, coder } = staffed(dir)
    store.post({ kind: 'note', from: manager.id, to: coder.id, body: 'not yours' })
    store.post({ kind: 'status', from: manager.id, to: OWNER, body: 'yours' })

    const mine = store.conversation({ withFloor: OWNER }).map((m) => m.body)
    assert.deepEqual(mine, ['yours'])
    store.close()
  } finally {
    cleanup()
  }
})
