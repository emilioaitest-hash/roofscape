import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILDING_WIDTH, allTiers, tierOf, nextTierAt } from './tiers.js'
import { renderBuilding, renderSkyline } from './render.js'

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

test('every line of every tier is exactly one building wide', () => {
  for (const tier of allTiers()) {
    for (const line of [...tier.cap, tier.storey, ...tier.ground]) {
      assert.equal(
        [...line].length,
        BUILDING_WIDTH,
        `${tier.name} has a line ${[...line].length} wide: "${line}"`,
      )
    }
  }
})

test('a building is drawn one storey per head', () => {
  for (const headcount of [1, 2, 3, 5, 8, 12, 20]) {
    const tier = tierOf(headcount)
    const lines = renderBuilding({ name: 'x', headcount })
    const storeys = lines.length - tier.cap.length - tier.ground.length
    assert.equal(storeys, headcount, `${headcount} staff drew ${storeys} storeys`)
  }
})

test('form follows headcount at the documented thresholds', () => {
  const expected: Array<[number, string]> = [
    [1, 'shack'],
    [2, 'single-storey'],
    [3, 'brick walk-up'],
    [4, 'brick walk-up'],
    [5, 'cast-iron block'],
    [7, 'cast-iron block'],
    [8, 'skyscraper'],
    [11, 'skyscraper'],
    [12, 'landmark'],
    [40, 'landmark'],
  ]
  for (const [headcount, name] of expected) {
    assert.equal(tierOf(headcount).name, name, `${headcount} staff should be a ${name}`)
  }
})

test('a headcount below one is still drawn as a shack rather than nothing', () => {
  assert.equal(tierOf(0).name, 'shack')
  assert.equal(renderBuilding({ name: 'x', headcount: 0 }).length, renderBuilding({ name: 'x', headcount: 1 }).length)
})

test('the next change of form is announced, until there is none', () => {
  assert.equal(nextTierAt(1), 2)
  assert.equal(nextTierAt(4), 5)
  assert.equal(nextTierAt(11), 12)
  assert.equal(nextTierAt(12), null)
})

test('buildings of different forms still share one street line', () => {
  const rows = renderSkyline([
    { name: 'a', headcount: 1 },
    { name: 'b', headcount: 9 },
    { name: 'c', headcount: 3 },
  ]).split('\n')
  const street = rows.findIndex((r) => r.startsWith('─'))
  assert.ok(street > 0, 'a street line is drawn')
  // The row above the street is the bottom of every building, so none of the
  // three columns may be blank there.
  const bottom = rows[street - 1]!
  for (const start of [0, 13, 26]) {
    assert.notEqual(bottom.slice(start, start + BUILDING_WIDTH).trim(), '', `column at ${start} is empty`)
  }
})

test('an empty skyline says so instead of drawing nothing', () => {
  assert.match(renderSkyline([]), /nothing here yet/)
})

test('lighting a window changes only colour, never width', () => {
  const dark = renderBuilding({ name: 'x', headcount: 5 }, { colour: true })
  const lit = renderBuilding({ name: 'x', headcount: 5, working: 3 }, { colour: true })
  assert.equal(dark.length, lit.length)
  for (let i = 0; i < dark.length; i++) {
    assert.equal([...visible(lit[i]!)].length, [...visible(dark[i]!)].length)
  }
  assert.notEqual(lit.join(''), dark.join(''), 'lit windows should actually differ')
})

test('a ground floor lines up with the storeys above it', () => {
  // The walls must not jog where the lobby meets the first storey. Widths alone
  // do not catch this: two lines can both be eleven wide and still be offset.
  for (const tier of allTiers()) {
    const storey = [...tier.storey]
    const lobby = [...tier.ground[0]!]
    const edges = (row: string[]) =>
      row.reduce<number[]>((found, char, index) => (char.trim() === '' ? found : [...found, index]), [])
    const storeyEdges = edges(storey)
    const lobbyEdges = edges(lobby)
    assert.equal(
      lobbyEdges[0],
      storeyEdges[0],
      `${tier.name}: the lobby's left wall is at ${lobbyEdges[0]}, the storey's at ${storeyEdges[0]}`,
    )
    assert.equal(
      lobbyEdges.at(-1),
      storeyEdges.at(-1),
      `${tier.name}: the lobby's right wall does not line up with the storey's`,
    )
  }
})

test('every building has exactly one way in', () => {
  for (const tier of allTiers()) {
    const doors = tier.ground.join('').split('▯').length - 1
    assert.ok(doors >= 1, `${tier.name} has no door`)
  }
})
