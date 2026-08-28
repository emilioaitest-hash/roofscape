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
import { runFloorTurn } from './run.js'
import { Workspace } from '../tools/workspace.js'
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

test('a rate-limited provider does not end the work; another one picks it up', async () => {
  // On a subscription plan this is not an edge case, it is Tuesday. Losing a
  // whole goal to a usage limit is the difference between a tool that works
  // unattended and one that does not.
  const s = scratch()
  try {
    const hadKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-for-tests'
    try {
      const coder = s.store.hire({
        role: 'coder', name: 'Nib', charter: 'You write it.',
        posting: { provider: 'anthropic', model: 'claude-sonnet-4-5', engine: 'direct' },
      })
      const task = s.store.assign({ by: coder.id, to: coder.id, goal: 'Write bye.js' })

      const asked: string[] = []
      const working = scriptedModel([
        [{ tool: 'write_file', input: { path: 'bye.js', content: 'export const farewell = () => "Bye"\n' } }],
        [{ tool: 'finish', input: { summary: 'Wrote it on the second provider.', artifacts: ['bye.js'], succeeded: true } }],
      ])

      const outcome = await runFloorTurn({
        building: s.building, store: s.store, credentials: s.skyline,
        floor: coder, task,
        workspace: new Workspace(s.repo), cwd: s.repo,
        ask: async () => false,
        resolveModel: (posting) => {
          asked.push(posting.provider)
          if (posting.provider === 'anthropic') {
            return new MockLanguageModelV4({
              doGenerate: async () => {
                throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })
              },
            })
          }
          return working
        },
      })

      assert.deepEqual(asked.slice(0, 2), ['anthropic', 'openai'], 'it asked the fallback after the limit')
      assert.equal(outcome.finished?.succeeded, true, 'and the work got done')
      assert.match(outcome.finished!.summary, /second provider/)

      // The bill belongs to whoever did the work, not to the one that refused it.
      const spent = s.store.spentOnTask(task.id)
      assert.ok(spent > 0, 'and the spend was recorded')
    } finally {
      if (hadKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = hadKey
    }
  } finally {
    s.cleanup()
  }
})

test('a request nobody could satisfy is not tried at every provider in turn', async () => {
  // Every provider refuses a model id that does not exist. Trying each just
  // spends the timeout and tells the owner nothing new.
  const s = scratch()
  try {
    const hadKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-for-tests'
    try {
      const coder = s.store.hire({
        role: 'coder', name: 'Nib', charter: 'x',
        posting: { provider: 'anthropic', model: 'no-such-model', engine: 'direct' },
      })
      const task = s.store.assign({ by: coder.id, to: coder.id, goal: 'Anything' })

      const asked: string[] = []
      const outcome = await runFloorTurn({
        building: s.building, store: s.store, credentials: s.skyline,
        floor: coder, task,
        workspace: new Workspace(s.repo), cwd: s.repo,
        ask: async () => false,
        resolveModel: (posting) => {
          asked.push(posting.provider)
          return new MockLanguageModelV4({
            doGenerate: async () => {
              throw Object.assign(new Error('model not found'), { statusCode: 404 })
            },
          })
        },
      })

      assert.deepEqual(asked, ['anthropic'], 'it stopped after the first refusal')
      assert.equal(outcome.finished, null)
      assert.match(outcome.note, /malformed|model/i, 'and said what was actually wrong')
    } finally {
      if (hadKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = hadKey
    }
  } finally {
    s.cleanup()
  }
})

test('a monthly allowance actually stops work, rather than being decoration', async () => {
  // It was stored on every building and read by nothing, which is worse than
  // having no budget at all: the owner believes there is a ceiling.
  const s = scratch()
  try {
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
    s.skyline.setBudget(s.building.id, { monthlyTokens: 1000, perTaskTokens: 500 })

    // Spend it.
    s.store.recordSpend({ floor: coder.id, provider: 'anthropic', model: 'x', inputTokens: 0, outputTokens: 1200 })
    assert.ok(s.store.spentThisMonth() >= 1000)

    const spent = s.skyline.get(s.building.id)!
    await assert.rejects(
      () => pursueGoal(
        { building: spent, store: s.store, credentials: s.skyline, ask: async () => false, report: () => {},
          resolveModel: () => scriptedModel([[{ text: 'should never be asked' }]]) },
        'Do more work',
      ),
      (error: unknown) => {
        assert.match((error as Error).message, /spent .* of its .* output tokens this month/)
        assert.match((error as Error).message, /roofscape budget/, 'and says how to lift it')
        return true
      },
    )
  } finally {
    s.cleanup()
  }
})

test('a building under its allowance is not stopped', async () => {
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    s.skyline.setBudget(s.building.id, { monthlyTokens: 1_000_000, perTaskTokens: 500 })

    const scripts = new Map([
      ['m', scriptedModel([[{ tool: 'finish', input: { summary: 'Nothing needed doing.', artifacts: [], succeeded: true } }]])],
    ])
    const outcome = await pursueGoal(
      { building: s.skyline.get(s.building.id)!, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {}, resolveModel: (p) => scripts.get(p.model)! },
      'Have a look around',
    )
    assert.match(outcome.managerSummary, /Nothing needed doing/)
  } finally {
    s.cleanup()
  }
})

test("the building's per-task ceiling is applied to whatever the manager assigned", async () => {
  // Likewise stored and never used. A manager could assign a task with a limit
  // far above what the building was supposed to allow.
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: posting('c') })
    s.skyline.setBudget(s.building.id, { monthlyTokens: null, perTaskTokens: 700 })

    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'assign_task', input: { to: coder.id, goal: 'Something', acceptance: ['done'] } }],
        [{ tool: 'finish', input: { summary: 'Assigned.', artifacts: [], succeeded: true } }],
      ])],
      ['c', scriptedModel([[{ tool: 'finish', input: { summary: 'Done.', artifacts: [], succeeded: true } }]])],
    ])
    await pursueGoal(
      { building: s.skyline.get(s.building.id)!, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {}, resolveModel: (p) => scripts.get(p.model) ?? scripts.get('c')! },
      'Do a thing',
    )

    const task = s.store.tasks()[0]!
    assert.equal(task.limits.tokens, 700, 'the ceiling followed the task, not the default')
  } finally {
    s.cleanup()
  }
})

test('a second goal on a building already being worked is refused', async () => {
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    s.store.claim('the-daemon')

    await assert.rejects(
      () => pursueGoal(
        { building: s.building, store: s.store, credentials: s.skyline, ask: async () => false,
          report: () => {}, holder: 'the-terminal',
          resolveModel: () => scriptedModel([[{ text: 'never asked' }]]) },
        'Do a thing',
      ),
      (error: unknown) => {
        assert.match((error as Error).message, /already being worked on by the-daemon/)
        return true
      },
    )
  } finally { s.cleanup() }
})

test('a goal releases the building when it is done, even if it failed', async () => {
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })

    const scripts = new Map([
      ['m', scriptedModel([[{ tool: 'finish', input: { summary: 'Nothing to do.', artifacts: [], succeeded: true } }]])],
    ])
    await pursueGoal(
      { building: s.building, store: s.store, credentials: s.skyline, ask: async () => false,
        report: () => {}, holder: 'first', resolveModel: (p) => scripts.get(p.model)! },
      'Have a look',
    )
    assert.equal(s.store.claimHolder(), null, 'the building is free again')

    // And a goal whose model will not answer must free it too, or one bad run
    // locks the building. The turn does not throw — the runtime catches a model
    // failure and reports it — so what matters is the claim, not an exception.
    const failed = await pursueGoal(
      { building: s.building, store: s.store, credentials: s.skyline, ask: async () => false,
        report: () => {}, holder: 'second',
        resolveModel: () => { throw new Error('the provider is on fire') } },
      'Break',
    )
    assert.match(failed.managerSummary, /on fire/, 'and it says what went wrong')
    assert.equal(s.store.claimHolder(), null, 'still free after a failure')
  } finally { s.cleanup() }
})

/**
 * The worst bug the product had. The only transition to `done` sat inside
 * `if (review)`; review was null whenever nobody in the building reviewed; and
 * a new building is founded with a manager and a coder — so nothing a new
 * building did could ever finish. Every success sat in `awaiting-review` for
 * good, and the windows it lit never went out.
 */
test('a building of a manager and a coder alone finishes what it does', async () => {
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: posting('c') })

    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'assign_task', input: { to: coder.id, goal: 'Add farewell', acceptance: ['it exists'] } }],
        [{ tool: 'finish', input: { summary: 'Assigned to Nib.', artifacts: [], succeeded: true } }],
      ])],
      ['c', scriptedModel([
        [{ tool: 'write_file', input: { path: 'bye.js', content: 'export const farewell = () => "Bye"\n' } }],
        [{ tool: 'finish', input: { summary: 'Wrote bye.js.', artifacts: ['bye.js'], succeeded: true } }],
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

    assert.equal(s.store.tasks()[0]!.state, 'done', 'the task actually finished')
    assert.equal(outcome.worked[0]!.settled, 'done')
    assert.equal(outcome.verdict, 'did-something')
    assert.equal(s.store.busyFloors(), 0, 'and the windows it lit have gone out')

    // And it is honest about why nobody read it, rather than quietly founding
    // the building with a reviewer it never asked for.
    assert.match(outcome.why, /nobody here reads finished work/i)
    assert.match(outcome.remedy!, /hire a reviewer/i)
  } finally {
    s.cleanup()
  }
})

test('a goal that never reached a model is not reported as finished', async () => {
  // The failure that made the product lie: a provider failure is reported, not
  // raised, so `pursueGoal` resolved happily and the page toasted "Finished."
  // in green over a goal nothing had even attempted.
  const s = scratch()
  try {
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })

    const outcome = await pursueGoal(
      {
        building: s.building, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {},
        resolveModel: () => {
          throw Object.assign(new Error('No credential for Anthropic.'), {
            name: 'ProviderError',
            remedy: 'Set ANTHROPIC_API_KEY in the environment, or run: roofscape provider add anthropic',
          })
        },
      },
      'Do something useful',
    )

    assert.equal(outcome.verdict, 'could-not-start')
    assert.equal(outcome.worked.length, 0, 'nothing was attempted')
    assert.match(outcome.why, /No credential/)
    assert.match(outcome.remedy!, /ANTHROPIC_API_KEY/, 'and the one thing that fixes it survives the trip')
  } finally {
    s.cleanup()
  }
})

test('a manager who assigns nothing says so rather than reporting success', async () => {
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })

    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'finish', input: { summary: 'Nobody here designs, so I assigned nothing.', artifacts: [], succeeded: true } }],
      ])],
    ])
    const outcome = await pursueGoal(
      {
        building: s.building, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {}, resolveModel: (p) => scripts.get(p.model)!,
      },
      'Design a logo',
    )

    assert.equal(outcome.verdict, 'did-nothing')
    assert.match(outcome.why, /Nobody here designs/, "and the reason is the manager's own")
  } finally {
    s.cleanup()
  }
})

test('a floor that could not reach a model is a goal that did nothing, with the remedy', async () => {
  // The likeliest shape of it in real life: the manager runs on an installed
  // Claude Code and the coder is posted to a provider with no key. The goal is
  // read, tasks are assigned, and not one of them can start.
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: posting('c') })

    const manager = scriptedModel([
      [{ tool: 'assign_task', input: { to: coder.id, goal: 'Write it', acceptance: ['it exists'] } }],
      [{ tool: 'finish', input: { summary: 'Assigned to Nib.', artifacts: [], succeeded: true } }],
    ])

    const outcome = await pursueGoal(
      {
        building: s.building, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {},
        resolveModel: (p) => {
          if (p.model === 'm') return manager
          throw Object.assign(new Error('No credential for OpenAI.'), {
            name: 'ProviderError',
            remedy: 'Set OPENAI_API_KEY in the environment, or run: roofscape provider add openai',
          })
        },
      },
      'Write the results page',
    )

    assert.equal(outcome.verdict, 'did-nothing')
    assert.match(outcome.why, /No credential for OpenAI/)
    assert.match(outcome.remedy!, /OPENAI_API_KEY/, 'the fix survives from the floor to the owner')
    assert.equal(s.store.tasks()[0]!.state, 'escalated', 'and the work is on the desk, not counted as done')
  } finally {
    s.cleanup()
  }
})

test('the goal you just typed is worked before whatever was left over', async () => {
  // Tasks were taken oldest-first across the whole building, so leftovers from
  // an earlier run were worked *instead of* the new goal's own — and "put a
  // goal to it" could not promise the building would work on that goal.
  const s = scratch()
  try {
    const posting = (model: string): Posting => ({ ...POSTING, model })
    const manager = s.store.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: posting('m') })
    const coder = s.store.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: posting('c') })
    for (let n = 1; n <= 6; n++) {
      s.store.assign({ by: manager.id, to: coder.id, goal: `Stale ${n}` })
    }

    const scripts = new Map([
      ['m', scriptedModel([
        [{ tool: 'assign_task', input: { to: coder.id, goal: 'The new thing', acceptance: ['it is done'] } }],
        [{ tool: 'finish', input: { summary: 'Assigned one task.', artifacts: [], succeeded: true } }],
      ])],
      ['c', scriptedModel([[{ tool: 'finish', input: { summary: 'Done.', artifacts: [], succeeded: true } }]])],
    ])

    const outcome = await pursueGoal(
      {
        building: s.building, store: s.store, credentials: s.skyline,
        ask: async () => false, report: () => {},
        resolveModel: (p) => scripts.get(p.model) ?? scripts.get('c')!,
      },
      'Do the new thing',
      { maxTasks: 2 },
    )

    assert.equal(outcome.worked[0]!.task.goal, 'The new thing', 'the new goal goes first')
    assert.equal(outcome.worked.length, 2, 'and the leftovers fill the room that is left')
    assert.equal(outcome.worked[1]!.task.goal, 'Stale 1')
    assert.equal(outcome.outstanding, 5, 'the rest are still waiting')
  } finally {
    s.cleanup()
  }
})
