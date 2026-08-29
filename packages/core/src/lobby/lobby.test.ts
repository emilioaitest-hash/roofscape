import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { SkylineStore } from '../store/skylineStore.js'
import { BuildingStore } from '../store/buildingStore.js'
import { lobbyTools } from './tools.js'
import { ask } from './concierge.js'
import type { BuildingId } from '../domain/ids.js'
import type { Posting } from '../domain/building.js'

const POSTING: Posting = { provider: 'anthropic', model: 'test', engine: 'direct' }

function scratch() {
  const home = mkdtempSync(join(tmpdir(), 'roofscape-lobby-'))
  const had = process.env.ROOFSCAPE_HOME
  process.env.ROOFSCAPE_HOME = home

  const sky = SkylineStore.open()
  const college = sky.breakGround({ name: 'College App', charter: 'The app for the college.', workspace: home })
  const help = sky.breakGround({ name: 'Help Center', charter: 'The support site.', workspace: home })

  const a = BuildingStore.open(college.id)
  a.hire({ role: 'manager', name: 'Ada', charter: 'x', posting: POSTING })
  a.hire({ role: 'coder', name: 'Nib', charter: 'x', posting: POSTING })
  a.remember({ scope: 'building', layer: 'semantic', text: 'The college app deploys to Fly, not Vercel.' })
  a.close()

  const b = BuildingStore.open(help.id)
  b.hire({ role: 'manager', name: 'Ida', charter: 'x', posting: POSTING })
  b.close()

  return {
    sky, college, help,
    cleanup: () => {
      sky.close()
      if (had === undefined) delete process.env.ROOFSCAPE_HOME
      else process.env.ROOFSCAPE_HOME = had
      rmSync(home, { recursive: true, force: true })
    },
  }
}

const noop = async () => 'not handed'

test('the concierge can see every building, which nobody inside one can', () => {
  const s = scratch()
  try {
    const tools = lobbyTools({ startGoal: noop })
    const list = tools.find((t) => t.name === 'list_buildings')!
    return list.run({}).then((result) => {
      const { buildings } = result as { buildings: Array<{ name: string; staff: number; form: string }> }
      assert.equal(buildings.length, 2)
      const college = buildings.find((b) => b.name === 'College App')!
      assert.equal(college.staff, 2)
      // Two on staff is the second rung, which is a bodega now that the ladder
      // is made of real New York buildings rather than generic ones.
      assert.equal(college.form, 'bodega')
    })
  } finally { s.cleanup() }
})

test('it can read one building\'s archives without belonging to it', async () => {
  const s = scratch()
  try {
    const recall = lobbyTools({ startGoal: noop }).find((t) => t.name === 'recall_in')!
    const found = (await recall.run({ building: 'College App', query: 'deploy' })) as {
      found: Array<{ text: string }>
    }
    assert.equal(found.found.length, 1)
    assert.match(found.found[0]!.text, /Fly/)
  } finally { s.cleanup() }
})

test('asking about a building that does not exist says so rather than throwing', async () => {
  const s = scratch()
  try {
    const look = lobbyTools({ startGoal: noop }).find((t) => t.name === 'look_into')!
    const result = (await look.run({ building: 'Nowhere' })) as { error?: string }
    assert.match(result.error ?? '', /No building called "Nowhere"/)
  } finally { s.cleanup() }
})

test('the concierge holds nothing that can change a building', () => {
  // It can see everything, so it should be able to alter very little. No files,
  // no shell, no hiring — only looking, and handing work to the people whose
  // job it is.
  const s = scratch()
  try {
    const names = lobbyTools({ startGoal: noop }).map((t) => t.name)
    for (const forbidden of ['write_file', 'edit_file', 'shell', 'assign_task', 'propose_hire', 'remember', 'forget']) {
      assert.equal(names.includes(forbidden), false, `the concierge was given ${forbidden}`)
    }
    assert.deepEqual(names.sort(), ['answer', 'hand_to', 'list_buildings', 'look_into', 'recall_in'])
  } finally { s.cleanup() }
})

test('it answers a question by looking, and says what it found', async () => {
  const s = scratch()
  try {
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        const move = step++ === 0
          ? { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'list_buildings', input: '{}' }
          : {
              type: 'tool-call' as const, toolCallId: 'c2', toolName: 'answer',
              input: JSON.stringify({ text: 'Two buildings: College App with two staff, Help Center with one.' }),
            }
        return {
          content: [move],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 20, text: 20, reasoning: 0 },
            totalTokens: 30,
          },
          warnings: [],
        }
      },
    })

    const result = await ask({
      question: 'What have I got?',
      credentials: s.sky,
      owner: { name: 'Sam', profile: '' },
      startGoal: noop,
      resolveModel: () => model,
    })

    assert.match(result.answer, /College App/)
    assert.ok(result.toolsUsed.includes('list_buildings'), 'it looked before answering')
  } finally { s.cleanup() }
})

test('a request for work is handed to the building whose job it is', async () => {
  const s = scratch()
  try {
    const handed: Array<{ building: string; goal: string }> = []
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        const move = step++ === 0
          ? {
              type: 'tool-call' as const, toolCallId: 'c1', toolName: 'hand_to',
              input: JSON.stringify({ building: 'College App', goal: 'Fix the login page' }),
            }
          : {
              type: 'tool-call' as const, toolCallId: 'c2', toolName: 'answer',
              input: JSON.stringify({ text: 'Handed to the College App.' }),
            }
        return {
          content: [move],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 20, text: 20, reasoning: 0 },
            totalTokens: 30,
          },
          warnings: [],
        }
      },
    })

    await ask({
      question: 'Please fix the login page on the college app',
      credentials: s.sky,
      owner: { name: '', profile: '' },
      startGoal: async (building: BuildingId, goal: string) => {
        handed.push({ building, goal })
        return 'started'
      },
      resolveModel: () => model,
    })

    assert.equal(handed.length, 1)
    assert.equal(handed[0]!.building, s.college.id, 'and it resolved the name to the right building')
    assert.match(handed[0]!.goal, /login/)
  } finally { s.cleanup() }
})
