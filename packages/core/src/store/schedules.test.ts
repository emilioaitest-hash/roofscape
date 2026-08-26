import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkylineStore } from './skylineStore.js'
import { parseEvery, parseAtTime, nextRun, describeEvery, describeSchedule } from './schedules.js'

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-sched-'))
  const sky = SkylineStore.open(join(dir, 'skyline.db'))
  const building = sky.breakGround({ name: 'Standing', charter: 'x', workspace: '/tmp/x' })
  return { sky, building, cleanup: () => { sky.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('an interval is read the way a person writes one', () => {
  assert.equal(parseEvery('30m'), 30)
  assert.equal(parseEvery('30 minutes'), 30)
  assert.equal(parseEvery('4h'), 240)
  assert.equal(parseEvery('2 days'), 2880)
  assert.equal(parseEvery('hourly'), 60)
  assert.equal(parseEvery('daily'), 1440)
  assert.equal(parseEvery('weekly'), 10080)
  assert.equal(parseEvery('  DAILY  '), 1440, 'spacing and case are not the point')
})

test('something we cannot read is refused rather than guessed at', () => {
  // A schedule that runs at the wrong interval is worse than one that was
  // refused, because nobody goes back and checks.
  for (const nonsense of ['', 'sometimes', 'every so often', '0m', '-5h', 'fortnightly']) {
    assert.equal(parseEvery(nonsense), null, `"${nonsense}" should not parse`)
  }
})

test('a time of day is read, and an impossible one is not', () => {
  assert.equal(parseAtTime('09:00'), 540)
  assert.equal(parseAtTime('9:05'), 545)
  assert.equal(parseAtTime('23:59'), 1439)
  assert.equal(parseAtTime('24:00'), null)
  assert.equal(parseAtTime('09:60'), null)
  assert.equal(parseAtTime('morning'), null)
})

test('a schedule made after its time today waits for tomorrow', () => {
  // Created at ten past nine, a nine o'clock job should not fire immediately for
  // a nine o'clock that has already gone.
  const tenPastNine = new Date('2026-03-04T09:10:00')
  const next = nextRun(tenPastNine, 1440, '09:00')
  assert.equal(next.getDate(), 5, 'it waits for tomorrow')
  assert.equal(next.getHours(), 9)
  assert.equal(next.getMinutes(), 0)
})

test('a schedule made before its time today runs today', () => {
  const eight = new Date('2026-03-04T08:00:00')
  const next = nextRun(eight, 1440, '09:00')
  assert.equal(next.getDate(), 4)
  assert.equal(next.getHours(), 9)
})

test('a multi-day rhythm with a time of day keeps its rhythm', () => {
  // Advancing by one day here would quietly turn "every three days at nine"
  // into a daily job.
  const late = new Date('2026-03-04T10:00:00')
  const next = nextRun(late, 60 * 24 * 3, '09:00')
  assert.equal(next.getDate(), 7)
})

test('without a time of day it is simply the interval from now', () => {
  const at = new Date('2026-03-04T08:00:00')
  assert.equal(nextRun(at, 90, null).toISOString(), new Date('2026-03-04T09:30:00').toISOString())
})

test('a standing order is scheduled forward, not fired on creation', () => {
  const s = scratch()
  try {
    const before = Date.now()
    const order = s.sky.schedule({ building: s.building.id, goal: 'Check the build', everyMinutes: 60 })
    assert.ok(new Date(order.nextRunAt).getTime() > before, 'a new order does not go off at once')
    assert.equal(order.enabled, true)
    assert.equal(order.lastRunAt, null)
    assert.equal(s.sky.dueSchedules().length, 0, 'and nothing is due yet')
  } finally { s.cleanup() }
})

test('an order becomes due when its time arrives', () => {
  const s = scratch()
  try {
    s.sky.schedule({ building: s.building.id, goal: 'Check the build', everyMinutes: 60 })
    const later = new Date(Date.now() + 61 * 60_000)
    assert.equal(s.sky.dueSchedules(later).length, 1)
  } finally { s.cleanup() }
})

test('a machine asleep for a week runs once when it wakes, not seven times', () => {
  // Moving forward from the time it was due would leave six more runs queued
  // behind it, and the owner would come back to a week of catch-up work.
  const s = scratch()
  try {
    const order = s.sky.schedule({ building: s.building.id, goal: 'Daily sweep', everyMinutes: 1440 })
    const aWeekLate = new Date(new Date(order.nextRunAt).getTime() + 7 * 24 * 60 * 60_000)

    assert.equal(s.sky.dueSchedules(aWeekLate).length, 1)
    s.sky.markScheduleRan(order.id, aWeekLate)
    assert.equal(s.sky.dueSchedules(aWeekLate).length, 0, 'the backlog does not pile up')

    const after = s.sky.schedules()[0]!
    assert.ok(new Date(after.nextRunAt).getTime() > aWeekLate.getTime())
    assert.equal(after.lastRunAt, aWeekLate.toISOString())
  } finally { s.cleanup() }
})

test('a disabled order stops coming due, and can be started again', () => {
  const s = scratch()
  try {
    const order = s.sky.schedule({ building: s.building.id, goal: 'Paused work', everyMinutes: 1 })
    const later = new Date(Date.now() + 10 * 60_000)
    assert.equal(s.sky.dueSchedules(later).length, 1)

    s.sky.setScheduleEnabled(order.id, false)
    assert.equal(s.sky.dueSchedules(later).length, 0)
    assert.equal(s.sky.schedules().length, 1, 'it is paused, not forgotten')

    s.sky.setScheduleEnabled(order.id, true)
    assert.equal(s.sky.dueSchedules(later).length, 1)

    s.sky.unschedule(order.id)
    assert.equal(s.sky.schedules().length, 0)
  } finally { s.cleanup() }
})

test('a schedule reads back the way it was written', () => {
  assert.equal(describeEvery(60), 'hourly')
  assert.equal(describeEvery(1440), 'daily')
  assert.equal(describeEvery(10080), 'weekly')
  assert.equal(describeEvery(180), 'every 3 hours')
  assert.equal(describeEvery(45), 'every 45 minutes')
  assert.match(
    describeSchedule({
      id: 'x', building: 'b' as never, goal: 'g', everyMinutes: 1440, atTime: '09:00',
      enabled: true, lastRunAt: null, nextRunAt: '', createdAt: '',
    }),
    /daily at 09:00/,
  )
})
