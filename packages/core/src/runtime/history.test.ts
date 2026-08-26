import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuildingStore } from '../store/buildingStore.js'
import { asBuildingId } from '../domain/ids.js'
import { recordWhatHappened } from './orchestrate.js'
import type { Posting } from '../domain/building.js'

const POSTING: Posting = { provider: 'anthropic', model: 'x', engine: 'direct' }

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-hist-'))
  const store = BuildingStore.open(asBuildingId('t'), join(dir, 'b.db'))
  return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('what happened is written down without anyone choosing to write it', () => {
  // Two real runs left the archives empty because every agent finished and none
  // called `remember`. History is the building's job, not the agent's.
  const { store, cleanup } = scratch()
  try {
    const mgr = store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const dev = store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    const task = store.assign({ by: mgr.id, to: dev.id, goal: 'Pad the seconds to two digits' })

    assert.equal(store.memoryCount(), 0)
    recordWhatHappened(store, {
      task,
      assignee: dev,
      summary: 'Used padStart.',
      succeeded: true,
      branch: 'roofscape/tsk_1',
      review: { by: 'Vet', accepted: true, verdict: 'ACCEPT — all criteria met' },
    })

    assert.equal(store.memoryCount(), 1)
    const found = store.recallByKeyword('padStart seconds')
    assert.equal(found.length, 1, 'and it is findable afterwards')
    const note = found[0]!
    assert.equal(note.layer, 'episodic')
    assert.equal(note.scope, 'building', 'history belongs to the building, not to one floor')
    assert.match(note.text, /Nib/, 'it says who did it')
    assert.match(note.text, /Vet accepted/, 'and what the reviewer made of it')
    assert.equal(note.source, task.id, 'and points back at the task')
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
})

test('an unfinished task is recorded as unfinished rather than quietly dropped', () => {
  const { store, cleanup } = scratch()
  try {
    const mgr = store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const dev = store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    const task = store.assign({ by: mgr.id, to: dev.id, goal: 'Something hard' })

    recordWhatHappened(store, {
      task, assignee: dev, summary: 'Could not find the config file.',
      succeeded: false, branch: null, review: null,
    })

    const note = store.recallByKeyword('config file')[0]!
    assert.match(note.text, /not finished/i, 'a failure is worth recalling, and is recorded as one')
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
})

test('a note stays short enough to be worth recalling', () => {
  // The first version pasted whole review verdicts in and produced notes of
  // 1,500 characters. A note is paid for every time it is recalled, and a long
  // one drowns its own keywords.
  const { store, cleanup } = scratch()
  try {
    const mgr = store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    const dev = store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    const task = store.assign({ by: mgr.id, to: dev.id, goal: 'G'.repeat(400) })

    recordWhatHappened(store, {
      task,
      assignee: dev,
      summary: 'S'.repeat(900),
      succeeded: true,
      branch: 'roofscape/tsk_1',
      review: { by: 'Vet', accepted: true, verdict: `ACCEPT\n\n${'V'.repeat(900)}` },
    })

    const note = store.browse({ limit: 1 })[0]!
    assert.ok(note.text.length < 700, `a note of ${note.text.length} characters is a transcript, not a note`)
    assert.match(note.text, /ACCEPT/, 'the verdict itself survives the trimming')
    assert.match(note.text, /Nib/)
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
})
