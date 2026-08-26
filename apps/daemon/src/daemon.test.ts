import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { Router, readJson, HttpError } from './router.js'
import { tokenMatches, bearerFrom } from './auth.js'
import { EventStream } from './events.js'

test('a route matches on method, path and captures its parameters', () => {
  const router = new Router()
  router.get('/api/buildings/:id', () => 'read')
  router.post('/api/buildings/:id/hire', () => 'hire')

  assert.equal(router.match('GET', '/api/buildings/times')?.params.id, 'times')
  assert.equal(router.match('POST', '/api/buildings/times/hire')?.params.id, 'times')
  assert.equal(router.match('POST', '/api/buildings/times'), null, 'method is part of the match')
  assert.equal(router.match('GET', '/api/buildings'), null, 'a missing segment is not a match')
  assert.equal(router.match('GET', '/api/buildings/times/extra'), null, 'nor is an extra one')
})

test('a parameter that arrived encoded is decoded once', () => {
  const router = new Router()
  router.get('/api/buildings/:id', () => 'read')
  assert.equal(router.match('GET', '/api/buildings/my%20building')?.params.id, 'my building')
})

test('a token is compared by content, and a wrong one of any length fails', () => {
  const real = 'a'.repeat(43)
  assert.equal(tokenMatches(real, real), true)
  assert.equal(tokenMatches('b'.repeat(43), real), false, 'same length, wrong value')
  assert.equal(tokenMatches('short', real), false, 'a length mismatch is not a crash')
  assert.equal(tokenMatches(undefined, real), false, 'and neither is nothing at all')
  assert.equal(tokenMatches('', real), false)
})

test('a bearer header is read, and anything else is not', () => {
  assert.equal(bearerFrom('Bearer abc123'), 'abc123')
  assert.equal(bearerFrom('bearer abc123'), 'abc123', 'the scheme is case-insensitive')
  assert.equal(bearerFrom('Basic abc123'), undefined)
  assert.equal(bearerFrom(undefined), undefined)
  assert.equal(bearerFrom(''), undefined)
})

const asRequest = (body: string): IncomingMessage =>
  Readable.from([Buffer.from(body)]) as unknown as IncomingMessage

test('a body is parsed, and an empty one is an empty object rather than a crash', async () => {
  assert.deepEqual(await readJson(asRequest('{"a":1}')), { a: 1 })
  assert.deepEqual(await readJson(asRequest('')), {})
  assert.deepEqual(await readJson(asRequest('   ')), {})
})

test('a body that is not JSON is the caller\'s fault, and says so', async () => {
  await assert.rejects(() => readJson(asRequest('not json')), (error: unknown) => {
    assert.ok(error instanceof HttpError)
    assert.equal(error.status, 400)
    return true
  })
})

test('an oversized body is refused rather than buffered', async () => {
  // A daemon on loopback is still a service, and a request body is still input
  // from somewhere. Ten megabytes of it should not become ten megabytes of heap.
  await assert.rejects(() => readJson(asRequest('x'.repeat(5000)), 1000), (error: unknown) => {
    assert.ok(error instanceof HttpError)
    assert.equal(error.status, 400)
    return true
  })
})

test('the event stream keeps recent events for a listener that arrives late', () => {
  const events = new EventStream()
  events.emit({ kind: 'progress', detail: 'one' })
  events.emit({ kind: 'progress', detail: 'two' })

  const written: string[] = []
  const fake = {
    writeHead: () => {},
    write: (chunk: string) => { written.push(chunk); return true },
    end: () => {},
  }
  const unsubscribe = events.subscribe(fake as never)

  assert.equal(events.watching, 1)
  const replayed = written.filter((line) => line.startsWith('data:'))
  assert.equal(replayed.length, 2, 'a dashboard opened mid-goal should not face an empty screen')
  assert.match(replayed[0]!, /one/)

  events.emit({ kind: 'progress', detail: 'three' })
  assert.match(written.at(-1)!, /three/, 'and it receives what happens next')

  unsubscribe()
  assert.equal(events.watching, 0)
})

test('the event backlog is bounded so a long run does not grow without limit', () => {
  const events = new EventStream()
  for (let i = 0; i < 250; i++) events.emit({ kind: 'progress', detail: `line ${i}` })

  const written: string[] = []
  const fake = {
    writeHead: () => {},
    write: (chunk: string) => { written.push(chunk); return true },
    end: () => {},
  }
  const stop = events.subscribe(fake as never)
  assert.ok(written.filter((l) => l.startsWith('data:')).length <= 100)
  stop()
})

test('a listener that has gone away does not break the ones that have not', () => {
  const events = new EventStream()
  const good: string[] = []
  const broken = {
    writeHead: () => {},
    write: () => { throw new Error('socket closed') },
    end: () => {},
  }
  const working = {
    writeHead: () => {},
    write: (chunk: string) => { good.push(chunk); return true },
    end: () => {},
  }
  const stopBroken = events.subscribe(broken as never)
  const stopWorking = events.subscribe(working as never)

  events.emit({ kind: 'progress', detail: 'still here' })
  assert.match(good.at(-1)!, /still here/)
  assert.equal(events.watching, 1, 'the dead one is dropped')
  stopBroken(); stopWorking()
})
