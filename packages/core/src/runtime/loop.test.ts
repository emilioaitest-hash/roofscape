import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { MockLanguageModelV4 } from 'ai/test'
import { SkylineStore } from '../store/skylineStore.js'
import { BuildingStore } from '../store/buildingStore.js'
import { pursueGoal } from './orchestrate.js'
import type { Posting } from '../domain/building.js'

const POSTING: Posting = { provider: 'anthropic', model: 'test', engine: 'direct' }

/**
 * A model that plays a fixed script.
 *
 * The whole loop is exercised in CI this way — no key, no network, no cost —
 * which is the only way a change to the orchestrator gets caught before it
 * reaches a real building.
 */
type Move = { tool: string; input: unknown } | { text: string }

function scriptedModel(script: ReadonlyArray<readonly Move[]>) {
  let turn = 0
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step = script[Math.min(turn++, script.length - 1)] ?? []
      const calls = step.filter((move): move is { tool: string; input: unknown } => 'tool' in move)
      // At this layer a finish reason is an object, not a string; `generateText`
      // is what flattens it to the word the runtime sees.
      const finishReason = {
        unified: (calls.length > 0 ? 'tool-calls' : 'stop') as 'tool-calls' | 'stop',
        raw: undefined,
      }
      return {
        content: step.map((move, index) =>
          'text' in move
            ? ({ type: 'text', text: move.text } as const)
            : ({
                type: 'tool-call',
                toolCallId: `call-${turn}-${index}`,
                toolName: move.tool,
                input: JSON.stringify(move.input),
              } as const),
        ),
        finishReason,
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 50, text: 50, reasoning: 0 },
          totalTokens: 150,
        },
        warnings: [],
      }
    },
  })
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'roofscape-loop-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'greet.js'), 'export const greet = (n) => "Hello " + n\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')

  const skyline = SkylineStore.open(join(root, 'skyline.db'))
  const building = skyline.breakGround({ name: 'Loop', charter: 'A test building.', workspace: repo, repos: [repo] })
  const store = BuildingStore.open(building.id, join(root, 'building.db'))
  return {
    root, repo, skyline, store, building,
    cleanup: () => { store.close(); skyline.close(); rmSync(root, { recursive: true, force: true }) },
  }
}

test('a goal becomes an assigned task, done work, a review, and a note in the archives', async () => {
  const s = scratch()
  try {
    // Each floor is posted to its own model id, which is how the harness knows
    // whose turn it is — the same mechanism real routing uses.
    const posting = (model: string): Posting => ({ ...POSTING, model })
    const manager = s.store.hire({ role: 'manager', name: 'Ada', charter: 'You run it.', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'You write it.', posting: posting('c') })
    s.store.hire({ role: 'reviewer', name: 'Vet', charter: 'You judge it.', posting: posting('r') })

    // Each floor gets its own script, chosen by which tools it holds.
    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'assign_task', input: { to: coder.id, goal: 'Add farewell', acceptance: ['farewell exists'] } }],
        [{ tool: 'finish', input: { summary: 'Assigned one task to Nib.', artifacts: [], succeeded: true } }],
      ])],
      ['c', scriptedModel([
        [{ tool: 'write_file', input: { path: 'bye.js', content: 'export const farewell = (n) => "Bye " + n\n' } }],
        [{ tool: 'finish', input: { summary: 'Wrote bye.js.', artifacts: ['bye.js'], succeeded: true } }],
      ])],
      ['r', scriptedModel([
        [{ tool: 'finish', input: { summary: 'ACCEPT — farewell exists.', artifacts: [], succeeded: true } }],
      ])],
    ])

    const outcome = await pursueGoal(
      {
        building: s.building,
        store: s.store,
        credentials: s.skyline,
        ask: async () => false,
        report: () => {},
        resolveModel: (p) => scripts.get(p.model) ?? scripts.get('c')!,
      },
      'Add a farewell function',
    )

    assert.match(outcome.managerSummary, /Assigned/, 'the manager reports what it did')
    assert.equal(outcome.worked.length, 1, 'one task was done')
    assert.equal(outcome.worked[0]!.succeeded, true)
    assert.ok(outcome.tokensSpent > 0, 'spending is accounted for')

    const notes = s.store.recallByKeyword('farewell')
    assert.ok(notes.length >= 1, 'the building wrote down what happened')
    assert.equal(notes[0]!.layer, 'episodic')
    assert.equal(manager.role, 'manager')
  } finally {
    s.cleanup()
  }
})

test('work sent back goes back to the person who did it, and can then be accepted', async () => {
  // Without this the review was only a comment: the task was marked escalated
  // and quietly dropped, and the point of having a reader is that something
  // happens when they object.
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'You run it.', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'You write it.', posting: posting('c') })
    s.store.hire({ role: 'reviewer', name: 'Vet', charter: 'You judge it.', posting: posting('r') })

    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'assign_task', input: { to: coder.id, goal: 'Add farewell', acceptance: ['farewell greets by name'] } }],
        [{ tool: 'finish', input: { summary: 'Assigned to Nib.', artifacts: [], succeeded: true } }],
      ])],
      ['c', scriptedModel([
        [{ tool: 'write_file', input: { path: 'bye.js', content: 'export const farewell = () => "Bye"\n' } }],
        [{ tool: 'finish', input: { summary: 'Wrote bye.js.', artifacts: ['bye.js'], succeeded: true } }],
        // The rework turn.
        [{ tool: 'write_file', input: { path: 'bye.js', content: 'export const farewell = (n) => "Bye " + n\n' } }],
        [{ tool: 'finish', input: { summary: 'It takes a name now.', artifacts: ['bye.js'], succeeded: true } }],
      ])],
      ['r', scriptedModel([
        [{ tool: 'finish', input: { summary: 'REJECT — farewell ignores the name it is given.', artifacts: [], succeeded: true } }],
        [{ tool: 'finish', input: { summary: 'ACCEPT — it greets by name now.', artifacts: [], succeeded: true } }],
      ])],
    ])

    const outcome = await pursueGoal(
      {
        building: s.building, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {},
        resolveModel: (p) => scripts.get(p.model) ?? scripts.get('c')!,
      },
      'Add a farewell function',
    )

    const item = outcome.worked[0]!
    assert.equal(item.reworks, 1, 'it went back exactly once')
    assert.equal(item.review?.accepted, true, 'and was accepted the second time')
    assert.match(item.summary, /takes a name/, 'the reported summary is the reworked one, not the first')

    const task = s.store.tasks()[0]!
    assert.equal(task.state, 'done', 'a task accepted after rework is done, not escalated')

    const note = s.store.recallByKeyword('farewell')[0]!
    assert.match(note.text, /went back 1 time/, 'and the archives say it took two goes')
  } finally {
    s.cleanup()
  }
})

test('a reviewer who is never satisfied does not loop forever', async () => {
  // Two who disagree do not converge by being asked again, and an unbounded
  // loop here is a budget on fire.
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: posting('c') })
    s.store.hire({ role: 'reviewer', name: 'Vet', charter: 'x', posting: posting('r') })

    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'assign_task', input: { to: coder.id, goal: 'Impossible', acceptance: ['perfection'] } }],
        [{ tool: 'finish', input: { summary: 'Assigned.', artifacts: [], succeeded: true } }],
      ])],
      ['c', scriptedModel([[{ tool: 'finish', input: { summary: 'Did what I could.', artifacts: [], succeeded: true } }]])],
      ['r', scriptedModel([[{ tool: 'finish', input: { summary: 'REJECT — still not right.', artifacts: [], succeeded: true } }]])],
    ])

    const outcome = await pursueGoal(
      {
        building: s.building, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {},
        resolveModel: (p) => scripts.get(p.model) ?? scripts.get('c')!,
      },
      'Do the impossible',
    )

    const item = outcome.worked[0]!
    assert.equal(item.reworks, 1, 'it tried once more and then stopped')
    assert.equal(item.review?.accepted, false)
    assert.equal(s.store.tasks()[0]!.state, 'escalated', 'and it is left for a person rather than retried again')
  } finally {
    s.cleanup()
  }
})
