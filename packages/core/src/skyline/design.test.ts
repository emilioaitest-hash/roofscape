import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designFor, seedOf, FLOOR_HEIGHT, TIER_ORDER, PALETTES } from './design.js'
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

test('a name made of emoji is cut between characters, not through one', () => {
  // Slicing by index halves a surrogate pair, and half a pair is not a
  // character: it survives JSON intact and arrives in the browser as tofu, or
  // becomes U+FFFD the moment the drawing is written to a file.
  const lonely = (svg: string) =>
    [...svg].some((c) => {
      const code = c.codePointAt(0)!
      return code >= 0xd800 && code <= 0xdfff
    })

  for (const name of ['🏢'.repeat(30), '🏢 🏭 🏬 '.repeat(6).trim(), '🏢', 'Café 🏢 Ltd']) {
    const svg = citySvg([{ id: 'e', name, headcount: 9 }], { width: 1400, height: 800 })
    assert.ok(!lonely(svg), `a half character survived in the drawing of "${name}"`)
  }
})

test('the canvas is bounded, however strange the frame it is given', () => {
  // `stars()` and `backdrop()` loop across the whole width, so a runaway one is
  // megabytes of markup — and an aspect of Infinity was a loop with no end.
  const shapes: Array<Record<string, number>> = [
    { width: 6000, height: 10 },
    { width: 1400, height: Number.MIN_VALUE },
    { width: 999999, height: 1 },
  ]
  for (const shape of shapes) {
    const svg = citySvg([{ id: 'a', name: 'A', headcount: 1 }], shape)
    const box = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    assert.ok(box, `no viewBox for ${JSON.stringify(shape)}`)
    assert.ok(Number(box[1]) <= 40_000, `${JSON.stringify(shape)} drew ${box[1]} units wide`)
    assert.ok(svg.length < 4_000_000, `${JSON.stringify(shape)} produced ${svg.length} bytes`)
  }
})

test('a width on its own is honoured rather than quietly dropped', () => {
  // The option exists to stop a drawing being marooned in its frame. Given one
  // dimension it used to throw both away and behave as though nothing was said.
  const asked = citySvg([{ id: 'a', name: 'A', headcount: 5 }], { width: 1400 })
  const silent = citySvg([{ id: 'a', name: 'A', headcount: 5 }], {})
  const widthOf = (svg: string) => Number(svg.match(/viewBox="0 0 ([\d.]+)/)![1])

  assert.ok(widthOf(asked) >= 1400, `asked for 1400 wide, got ${widthOf(asked)}`)
  assert.ok(widthOf(asked) > widthOf(silent), 'asking for a width changed nothing')
})

test('a headcount that is not a number is drawn as a shack, not as nothing', () => {
  // Math.max passes NaN through, and it reached the page as viewBox="0 0 NaN
  // NaN" — a document that renders as nothing rather than as an error.
  const d = designFor({ id: 'x', name: 'X', headcount: Number.NaN })
  assert.equal(d.floors, 1)
  assert.ok(Number.isFinite(d.height))

  const svg = citySvg([{ id: 'x', name: 'X', headcount: Number.NaN }], { width: 1400, height: 800 })
  assert.ok(!svg.includes('NaN'), 'NaN reached the drawing')
})

test('two buildings never share a gradient id, even when their seeds collide', () => {
  // The seed is a 32-bit hash and these two really do collide. The first
  // definition of a duplicated id wins, so one building was painted in the
  // other's walls while its trim and roof stayed its own.
  assert.equal(seedOf('b2cir:shack'), seedOf('b9kc:single-storey'), 'the collision this guards against')

  const svg = citySvg(
    [{ id: 'b2cir', name: 'One', headcount: 1 }, { id: 'b9kc', name: 'Two', headcount: 2 }],
    { width: 1400, height: 800 },
  )
  const ids = [...svg.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, ids.length, 'a gradient id was defined twice in one document')
})

test('a lit facade uses all three warmths', () => {
  // The old expression reduced to `index % 3`, so with a bay count divisible by
  // three every column came out one fixed tone from top to bottom.
  const svg = citySvg([{ id: 'w', name: 'W', headcount: 6, working: 6 }], { width: 1400, height: 800 })
  const tones = new Set([...svg.matchAll(/rs-t(\d)/g)].map((m) => m[1]))
  assert.deepEqual([...tones].sort(), ['0', '1', '2'])
})
