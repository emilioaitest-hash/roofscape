import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designFor, FLOOR_HEIGHT, TIER_ORDER, PALETTES } from './design.js'
import { citySvg, buildingSvg, portraitSvg } from './svg.js'
import { tierOf, allTiers } from './tiers.js'

const design = (id: string, headcount: number) => designFor({ id, name: id, headcount })

test('a building looks the same every time it is drawn', () => {
  // The whole point of deriving a design rather than storing one: reopening the
  // app must not redecorate the street.
  for (const headcount of [1, 3, 6, 9, 14, 22]) {
    const once = design('help-center', headcount)
    const twice = design('help-center', headcount)
    assert.deepEqual(twice, once, `a ${headcount}-storey building was drawn two different ways`)
  }
})

test('two buildings the same size do not look the same', () => {
  // This is the claim the home screen makes, so it is the claim worth testing.
  // Compared on the things somebody would actually notice from across a room.
  for (const headcount of [1, 4, 6, 10, 20]) {
    const looks = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const d = design(`co-${i}`, headcount)
      looks.add([d.palette.name, d.crown, d.base, d.window, d.bays, d.ornaments.join('+')].join('|'))
    }
    assert.ok(
      looks.size >= 8,
      `twelve buildings of ${headcount} produced only ${looks.size} distinct looks`,
    )
  }
})

test('a storey is the same height in every form', () => {
  // Height is headcount, and it stops being true the moment a tower's floors are
  // drawn shorter than a walk-up's. Without this the skyline lies.
  for (const tierName of TIER_ORDER) {
    const headcount = allTiers().findIndex((t) => t.name === tierName) + 1
    const d = design('x', Math.max(1, headcount))
    assert.equal(d.floorHeight, FLOOR_HEIGHT, `${tierName} uses its own storey height`)
  }
  // And the drawn shaft really is one storey per head.
  const five = design('x', 5)
  const six = design('x', 6)
  assert.equal(six.height - five.height, FLOOR_HEIGHT, 'a hire did not add exactly one storey')
})

test('a taller building is drawn taller', () => {
  let previous = 0
  for (let headcount = 1; headcount <= 30; headcount++) {
    const d = design('growing', headcount)
    // Crowns differ between forms, so compare the shaft rather than the spire.
    const shaft = d.baseHeight + d.floors * d.floorHeight
    assert.ok(shaft > previous, `${headcount} staff was not taller than ${headcount - 1}`)
    previous = shaft
  }
})

test('a building only redecorates when it changes form', () => {
  // Growing inside a form must not swap the brickwork; growing into a new one
  // is allowed to, because it has become a different kind of building.
  const five = design('steady', 5)
  const seven = design('steady', 7)
  assert.equal(seven.palette.name, five.palette.name, 'the cast-iron block repainted itself')
  assert.equal(seven.crown, five.crown)
  assert.equal(seven.floors, 7, 'but it did grow')

  const eight = design('steady', 8)
  assert.notEqual(eight.tier.name, five.tier.name, 'eight staff is a different form')
})

test('the forms are built out of materials that suit them', () => {
  const named = new Set<string>(Object.values(PALETTES).map((p) => p.name))
  for (let headcount = 1; headcount <= 25; headcount++) {
    for (let i = 0; i < 6; i++) {
      const d = design(`m-${i}`, headcount)
      assert.ok(named.has(d.palette.name), `${d.palette.name} is not a known material`)
    }
  }
  // A shack is not made of curtain wall, and a tower is not made of tar paper.
  const shacks = Array.from({ length: 12 }, (_, i) => design(`s-${i}`, 1).palette.name)
  assert.ok(!shacks.includes('blue curtain wall'), 'a shack was glazed')
})

test('a setback never leaves a floor wider than the one below it', () => {
  for (let headcount = 8; headcount <= 30; headcount++) {
    for (let i = 0; i < 5; i++) {
      const d = design(`t-${i}`, headcount)
      let last = Number.POSITIVE_INFINITY
      for (const setback of d.setbacks) {
        assert.ok(setback.atFloor > 0 && setback.atFloor < d.floors, 'a setback fell outside the shaft')
        assert.ok(setback.inset > 0, 'a setback that steps out is not a setback')
        assert.ok(setback.atFloor > 0 && setback.atFloor !== last, 'two setbacks on one floor')
        last = setback.atFloor
      }
    }
  }
})

test('the drawn city is well-formed and closes every tag it opens', () => {
  const svg = citySvg([
    { id: 'a', name: 'Help Center', headcount: 1, working: 1 },
    { id: 'b', name: 'The Big One', headcount: 20, working: 4, waiting: 2, busy: true },
    { id: 'c', name: 'Side Project', headcount: 6 },
  ])
  assert.match(svg, /^<svg /)
  assert.match(svg, /<\/svg>$/)
  const opens = (svg.match(/<g[\s>]/g) ?? []).length
  const closes = (svg.match(/<\/g>/g) ?? []).length
  assert.equal(opens, closes, 'unbalanced <g> in the drawn city')
})

test('a name reaches the screen, and a hostile one does not reach it as markup', () => {
  const svg = citySvg([{ id: 'x', name: 'Ben & Co <script>alert(1)</script>', headcount: 3 }])
  assert.ok(!svg.includes('<script>'), 'a building name was rendered as markup')
  assert.match(svg, /Ben &amp; Co/)
})

test('every form draws without throwing, at every size that reaches it', () => {
  for (let headcount = 0; headcount <= 34; headcount++) {
    const d = design(`all-${headcount}`, headcount)
    const svg = buildingSvg(d, { working: Math.min(headcount, 3), waiting: 1 })
    assert.ok(svg.length > 0, `${headcount} staff drew nothing`)
    assert.ok(!svg.includes('NaN'), `${headcount} staff drew NaN into the geometry`)
    assert.ok(!svg.includes('undefined'), `${headcount} staff drew undefined into the geometry`)
  }
})

test('an empty skyline is still a drawing', () => {
  const svg = citySvg([])
  assert.match(svg, /^<svg /)
  assert.match(svg, /Break ground/)
})

test('a portrait is one building and no empty lot beside it', () => {
  const svg = portraitSvg({ id: 'solo', name: 'Solo', headcount: 7 })
  assert.match(svg, /^<svg /)
  assert.ok(!svg.includes('Break ground'), 'a portrait offered a second plot')
})

test('the form a design reports is the form the ladder says it is', () => {
  for (let headcount = 0; headcount <= 40; headcount++) {
    assert.equal(design('x', headcount).tier.name, tierOf(Math.max(1, headcount)).name)
  }
})
