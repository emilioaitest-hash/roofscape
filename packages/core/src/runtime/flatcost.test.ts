import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuildingStore } from '../store/buildingStore.js'
import { coreSystemPrompt } from './prompt.js'
import { asBuildingId } from '../domain/ids.js'
import type { Building, Posting } from '../domain/building.js'

const POSTING: Posting = { provider: 'anthropic', model: 'x', engine: 'direct' }

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-cost-'))
  const store = BuildingStore.open(asBuildingId('t'), join(dir, 'b.db'))
  return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const building: Building = {
  id: asBuildingId('t'),
  name: 'Cost',
  charter: 'A building for measuring what a turn costs.',
  workspace: '/tmp/cost',
  repos: [],
  budget: { monthlyTokens: null, perTaskTokens: 1000 },
  createdAt: new Date().toISOString(),
  closedAt: null,
}

const promptFor = (store: BuildingStore) => {
  const floor = store.staff()[0]!
  return coreSystemPrompt({
    building,
    floor,
    colleagues: store.staff(),
    pinned: store.pinned(floor.id),
    workspaceDisplay: '.',
    memoryCount: store.memoryCount(),
  })
}

test('the cost of a turn does not grow with the size of the archives', () => {
  // This is the claim the whole memory design exists to make, and it is the kind
  // of claim that quietly stops being true. Ten notes and ten thousand must cost
  // about the same to carry, because nothing is carried — it is fetched.
  const { store, cleanup } = scratch()
  try {
    store.hire({ role: 'coder', name: 'Nib', charter: 'You write code.', posting: POSTING })

    for (let i = 0; i < 10; i++) {
      store.remember({ scope: 'building', layer: 'episodic', text: `An early note number ${i} about the header.` })
    }
    const small = promptFor(store).length

    for (let i = 0; i < 10_000; i++) {
      store.remember({
        scope: 'building',
        layer: 'episodic',
        text: `A note number ${i} about some work on the results table, the header, or the deploy.`,
      })
    }
    const large = promptFor(store).length

    assert.equal(store.memoryCount(), 10_010)
    // The only thing that legitimately grows is the sentence saying how many
    // notes there are, which is a few characters.
    assert.ok(
      large - small < 40,
      `the prompt grew by ${large - small} characters between 10 notes and 10,010`,
    )
    assert.ok(small > 400, 'and it is a real prompt, not an empty one')
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
})

test('pinned notes are the one thing that does cost every turn', () => {
  // Pinning is the deliberate exception, so it should be visible in the size —
  // otherwise nobody would believe the warning that says pinning is expensive.
  const { store, cleanup } = scratch()
  try {
    store.hire({ role: 'coder', name: 'Nib', charter: 'You write code.', posting: POSTING })
    const before = promptFor(store).length

    for (let i = 0; i < 5; i++) {
      store.remember({ scope: 'building', layer: 'semantic', text: `A pinned fact number ${i}.`, pinned: true })
    }
    const after = promptFor(store).length

    assert.ok(after > before, 'a pinned note is carried, not fetched')
    assert.ok(after - before < 400, 'but five short ones are still only a few hundred characters')
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
})

test('recall of a specific thing does not slow down as the archives grow', () => {
  // Measured against itself, not the clock: the suite runs ten files at once and
  // an absolute budget failed at random, which teaches you to ignore a red build.
  //
  // The notes are deliberately varied. An earlier version made every note
  // contain the search terms, and then asserted that recall stayed flat — but
  // FTS5 scales with the number of *matches*, not the size of the corpus, so
  // that test demanded something untrue and failed about half the time. A real
  // query is selective, and that is the case worth defending.
  const { store, cleanup } = scratch()
  try {
    store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    store.remember({ scope: 'building', layer: 'semantic', text: 'The deploy target is Fly, not Vercel.' })

    const topics = ['results table', 'race entries', 'club roster', 'photo gallery', 'email digest', 'ticket sales']
    const fill = (from: number, to: number) => {
      for (let i = from; i < to; i++) {
        store.remember({
          scope: 'building',
          layer: 'episodic',
          text: `Note ${i} about the ${topics[i % topics.length]} and what it needed.`,
        })
      }
    }

    fill(0, 200)
    const small = time(() => store.recallByKeyword('Vercel deploy', { limit: 6 }))

    fill(200, 10_000)
    const large = time(() => store.recallByKeyword('Vercel deploy', { limit: 6 }))

    assert.ok(store.recallByKeyword('Vercel', { limit: 6 }).length > 0, 'it still finds the needle')
    assert.ok(
      large < Math.max(small * 20, 10),
      `recall went from ${small.toFixed(2)}ms at 201 notes to ${large.toFixed(2)}ms at 10,001 — that is not an index`,
    )
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
})

/** Median of a few runs, so one unlucky scheduling slice does not decide it. */
function time(work: () => unknown): number {
  const runs: number[] = []
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    work()
    runs.push(performance.now() - started)
  }
  return runs.sort((a, b) => a - b)[2]!
}
