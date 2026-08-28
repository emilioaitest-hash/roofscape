import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCENTS, PALETTES, MATERIALS, REGISTER_SLIP, TIER_ORDER,
  WINDOW_SHAPES, CROWN_KINDS, BASE_KINDS, ORNAMENTS, STREET_FURNITURE,
  designFor, seedOf, streetFurniture, FLOOR_HEIGHT,
  type Palette, type MaterialFamily,
} from './design.js'
import { citySvg, buildingSvg, portraitSvg } from './svg.js'
import { tierOf, allTiers, type TierName } from './tiers.js'

const design = (id: string, headcount: number) => designFor({ id, name: id, headcount })

// ---- the material bar -----------------------------------------------------

/*
 * The rule the whole drawing rests on: marigold means a light is on and
 * vermilion means something is waiting on you, and *nothing else in the city is
 * allowed near either.* A single lit window has to carry across a street of
 * thirty buildings, and it cannot if one of those buildings is painted brass.
 *
 * The two bands are written down in the spec as a hue range and a chroma floor.
 * Hue is the plain HSL angle — marigold `#EFAA22` is 40° and vermilion
 * `#D2452A` is 10°, which is what puts each inside its own band — and chroma is
 * OKLCh's, which is the only one of the two whose numbers are on the 0–0.4
 * scale the thresholds use. Lightness is OKLab's, ×100, so "20 L* darker" is 20
 * points on the same scale the eye reads as evenly spaced.
 *
 * The escape hatch is the last clause and it is the honest one: a colour deep
 * inside the band is fine if it is far enough *below* the meaning colour that
 * nobody could mistake one for the other. That is what lets the city keep brick
 * and bare timber, which are warm and always were.
 */
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/** Plain HSL hue, in degrees. */
function hueOf(hex: string): number {
  const [r, g, b] = channels(hex)
  const max = Math.max(r, g, b)
  const spread = max - Math.min(r, g, b)
  if (spread === 0) return 0
  const sixth = max === r ? (g - b) / spread : max === g ? 2 + (b - r) / spread : 4 + (r - g) / spread
  return ((sixth * 60) % 360 + 360) % 360
}

/** OKLab lightness ×100, and OKLCh chroma. */
function labOf(hex: string): { lightness: number; chroma: number } {
  const [r, g, b] = channels(hex).map(srgbToLinear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    lightness: (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100,
    chroma: Math.hypot(
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ),
  }
}

const MEANING = [
  { name: 'marigold', hex: '#EFAA22', from: 20, to: 55, chroma: 0.09 },
  { name: 'vermilion', hex: '#D2452A', from: 0, to: 20, chroma: 0.1 },
] as const

/** Which meaning band a colour is inside, near enough to be confused with. */
function insideMeaning(hex: string): string | null {
  const hue = hueOf(hex)
  const { lightness, chroma } = labOf(hex)
  for (const band of MEANING) {
    if (hue < band.from || hue > band.to) continue
    if (chroma <= band.chroma) continue
    if (lightness <= labOf(band.hex).lightness - 20) continue
    return `${band.name} (hue ${hue.toFixed(0)}, chroma ${chroma.toFixed(3)}, lightness ${lightness.toFixed(0)})`
  }
  return null
}

test('the bands catch the two colours they are drawn around', () => {
  // The test is only worth anything if it can see the thing it is looking for,
  // and both meaning hues are by definition inside their own band.
  for (const band of MEANING) {
    assert.equal(insideMeaning(band.hex)?.startsWith(band.name), true, `${band.name} is not in its own band`)
  }
  // And this is the colour that was actually in the accent pool: `ACCENTS[0]`
  // used to be `#d4703a`, byte-identical to `--flag`, so one building in ten
  // wore the "this needs you" colour as awning paint.
  assert.ok(insideMeaning('#d4703a'), 'the terracotta that used to be an accent reads as clear')
})

test('no paint on any building sits inside a meaning hue', () => {
  const offenders: string[] = []
  for (const palette of Object.values(PALETTES) as Palette[]) {
    for (const role of ['wall', 'shade', 'lit', 'trim', 'roof'] as const) {
      const verdict = insideMeaning(palette[role])
      if (verdict) offenders.push(`${palette.name}.${role} ${palette[role]} is ${verdict}`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('no accent sits inside a meaning hue either', () => {
  const offenders = ACCENTS.filter((hex) => insideMeaning(hex)).map(
    (hex) => `${hex} is ${insideMeaning(hex)}`,
  )
  assert.deepEqual(offenders, [], offenders.join('\n'))
  // Byte-identical is the failure this pool was rewritten to fix; check for it
  // directly as well, because it is the one nobody would look twice at.
  assert.ok(!(ACCENTS as readonly string[]).includes('#d4703a'))
})

test('a socket is a recess rather than a hole cut through to nothing', () => {
  // On a light ground "lit" cannot mean "lighter than the wall" — it means a
  // hole that has been filled. The hole has to be clearly darker than its wall,
  // and clearly not black, or the counter inside it has nothing to sit against.
  for (const palette of Object.values(PALETTES) as Palette[]) {
    const wall = labOf(palette.wall).lightness
    const socket = labOf(palette.socket).lightness
    assert.ok(wall - socket >= 12, `${palette.name}: the socket is barely darker than the wall`)
    assert.ok(socket >= 15, `${palette.name}: the socket is near-black, not a recess`)
  }
})

test('the caught light on a mass is derived from the wall, not chosen beside it', () => {
  // `lit` is a *relationship* — the wall taken toward warm white — and it only
  // works if every building does it by the same amount.
  for (const palette of Object.values(PALETTES) as Palette[]) {
    const wall = labOf(palette.wall).lightness
    const lit = labOf(palette.lit).lightness
    assert.ok(lit > wall, `${palette.name}: the chamfer is not lighter than the wall`)
    assert.ok(lit - wall < 22, `${palette.name}: the chamfer is a second colour rather than the same wall`)
  }
})

// ---- the same building, every time ----------------------------------------

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
  // drawn shorter than a brownstone's. Without this the skyline lies.
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
  // Growing inside a form must not swap the paintwork; growing into a new one
  // is allowed to, because it has become a different kind of building.
  const five = design('steady', 5)
  const seven = design('steady', 7)
  assert.equal(seven.palette.name, five.palette.name, 'the cast-iron loft repainted itself')
  assert.equal(seven.crown, five.crown)
  assert.equal(seven.floors, 7, 'but it did grow')

  const eight = design('steady', 8)
  assert.notEqual(eight.tier.name, five.tier.name, 'eight staff is a different form')
})

test('a plate that is out of register stays out of register as the building grows', () => {
  // The misprint belongs to the press, not to the form. A building that takes
  // somebody on has not been reprinted; it has had a storey added.
  const before = design('press', 4).register
  const after = design('press', 9).register
  assert.deepEqual(after, before, 'growing into a new form moved the colour plate')

  for (let headcount = 1; headcount <= 12; headcount++) {
    const { dx, dy } = design(`slip-${headcount}`, headcount).register
    assert.ok(Math.abs(dx) <= REGISTER_SLIP && Math.abs(dy) <= REGISTER_SLIP, 'the slip ran away')
    // Never landed perfectly: a building in register has nothing to snap back
    // to on hover, and next to its neighbours it looks like it failed to draw.
    assert.ok(Math.abs(dx) > 0.3 && Math.abs(dy) > 0.3, 'a plate landed dead on the ink')
  }

  // And two buildings are out by different amounts, which is the whole point.
  const slips = new Set(
    Array.from({ length: 10 }, (_, i) => JSON.stringify(design(`r-${i}`, 5).register)),
  )
  assert.ok(slips.size >= 8, `ten buildings shared ${10 - slips.size} misprints`)
})

test('the ladder is geological: masonry at the bottom, metal and glass at the top', () => {
  /*
   * Low buildings are masonry and paint; tall ones are metal and glass. That is
   * true outside, and it is what makes a skyline legible from across a room —
   * you know roughly how big a building is before you have counted a storey.
   * A brownstone is never black steel and a supertall is never red brick.
   *
   * Painted cast iron gets the strictest clause of the lot: it belongs to the
   * loft and to nothing else, because a block that reads as SoHo is the whole
   * reason that rung has a name.
   */
  const allowed: Record<TierName, readonly MaterialFamily[]> = {
    newsstand: ['street', 'masonry'],
    bodega: ['street', 'masonry'],
    brownstone: ['masonry'],
    'cast-iron loft': ['iron', 'masonry'],
    'setback tower': ['masonry'],
    landmark: ['masonry', 'metal'],
    supertall: ['metal'],
  }

  for (const tier of TIER_ORDER) {
    const materials = MATERIALS[tier]
    assert.ok(materials.length >= 4, `${tier} is built out of only ${materials.length} things`)
    for (const key of materials) {
      const palette = PALETTES[key]
      assert.ok(
        allowed[tier].includes(palette.family),
        `a ${tier} can be built out of ${palette.name}, which is ${palette.family}`,
      )
    }
  }

  // Said the other way round, because these are the two sentences the brief
  // actually makes and they are the ones worth failing on.
  const families = (tier: TierName) => MATERIALS[tier].map((key) => PALETTES[key].family)
  assert.ok(!families('brownstone').includes('metal'), 'a brownstone was clad in steel')
  assert.ok(!families('supertall').includes('masonry'), 'a supertall was built out of brick')
  for (const tier of TIER_ORDER) {
    if (tier === 'cast-iron loft') continue
    assert.ok(!families(tier).includes('iron'), `${tier} was painted up as cast iron`)
  }

  // And what a building actually comes out wearing is on its own form's list.
  for (let headcount = 1; headcount <= 25; headcount++) {
    for (let i = 0; i < 6; i++) {
      const d = design(`m-${i}`, headcount)
      const names = MATERIALS[d.tier.name].map((key) => PALETTES[key].name)
      assert.ok(names.includes(d.palette.name), `a ${d.tier.name} turned up in ${d.palette.name}`)
    }
  }
})

test('every word in the vocabulary is on a list some building can reach', () => {
  // A crown nobody can reach is a crown that is not in the city, and the way one
  // goes missing is by being dropped off the one list that mentions it. This is
  // the cheap half of the check; the sweep below proves each one also draws.
  const seen = {
    window: new Set<string>(),
    crown: new Set<string>(),
    base: new Set<string>(),
    ornament: new Set<string>(),
  }
  for (let i = 0; i < 600; i++) {
    for (const headcount of [1, 2, 3, 5, 9, 13, 19]) {
      const d = design(`v-${i}`, headcount)
      seen.window.add(d.window)
      seen.crown.add(d.crown)
      seen.base.add(d.base)
      for (const ornament of d.ornaments) seen.ornament.add(ornament)
    }
  }
  const missing = (all: readonly string[], found: Set<string>) => all.filter((x) => !found.has(x))
  assert.deepEqual(missing(WINDOW_SHAPES, seen.window), [], 'window shapes no building can have')
  assert.deepEqual(missing(CROWN_KINDS, seen.crown), [], 'crowns no building can wear')
  assert.deepEqual(missing(BASE_KINDS, seen.base), [], 'bases no building can stand on')
  assert.deepEqual(missing(ORNAMENTS, seen.ornament), [], 'ornaments nobody can be carrying')
})

test('the two jokes are rationed to the one form that earns them', () => {
  // One gargoyle per skyline, and a crane only on the thing that is still going
  // up. Both stop being funny the moment they are everywhere.
  for (let i = 0; i < 200; i++) {
    for (const headcount of [1, 2, 3, 5, 9, 13, 19, 24]) {
      const d = design(`j-${i}`, headcount)
      if (d.ornaments.includes('gargoyle')) assert.equal(d.tier.name, 'landmark')
      if (d.ornaments.includes('crane')) assert.equal(d.tier.name, 'supertall')
      if (d.ornaments.includes('fire-escape')) {
        assert.ok(['brownstone', 'cast-iron loft'].includes(d.tier.name), 'a fire escape on a tower')
      }
    }
  }
  // And the one thing each form always has, because without it the form is not
  // that form: a deli with no awning is a shop with the lights on, and a SoHo
  // loft with no fire escape down the front is a warehouse.
  for (let i = 0; i < 40; i++) {
    assert.ok(design(`sig-${i}`, 2).ornaments.includes('deli-awning'), 'a bodega with no awning')
    assert.ok(design(`sig-${i}`, 6).ornaments.includes('fire-escape'), 'a loft with no fire escape')
  }
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

// ---- the drawing ----------------------------------------------------------

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

test('every building comes off two plates, and the colour one lands off the ink', () => {
  const svg = citySvg([{ id: 'press', name: 'Press', headcount: 7 }], { width: 1400, height: 800 })
  const { dx, dy } = design('press', 7).register
  assert.ok(svg.includes('class="rs-plate-ink"'), 'no ink plate')

  /*
   * The plate carries a *direction*, not a distance. A press misregisters by a
   * fixed distance on the paper, not by a fraction of whatever it is printing —
   * and emitting drawing units meant the slip shrank with the city, down to
   * between 0.44 and 0.98 CSS pixels on a real home screen. Half a pixel is
   * nothing on a one-times display, so the signature of the whole language was
   * below the resolution of the screen it ships on.
   *
   * The page supplies the distance as `--rs-slip`, worked back through the
   * scale it is really rendering at, and the fallback in the stylesheet keeps a
   * standalone SVG printing exactly as it used to.
   */
  const round2 = (n: number) => Math.round(n * 100) / 100
  assert.ok(
    svg.includes(
      `class="rs-plate-colour" style="--rs-dx:${round2(dx / REGISTER_SLIP)};--rs-dy:${round2(dy / REGISTER_SLIP)}"`,
    ),
    'the colour plate carries no misregistration for CSS to snap back',
  )
  assert.match(svg, /--rs-dx, 0\) \* var\(--rs-slip, [\d.]+px\)/, 'the slip has no distance to scale')
  // Snapping into register on hover is the whole hover interaction, and it has
  // to survive the drawing being handed around on its own.
  assert.match(svg, /\.rs-plot:hover \.rs-plate-colour[^}]*transform: none/)
})

test('the night is gone: no sky, no moon, no streetlight', () => {
  const svg = citySvg([{ id: 'a', name: 'A', headcount: 6, working: 2 }], { width: 1400, height: 800 })
  for (const gone of ['rs-sky', 'rs-haze', 'rs-moonglow', 'rs-lampglow', 'rs-lamppool', 'rs-lamps']) {
    assert.ok(!svg.includes(gone), `${gone} survived the daylight`)
  }
  // One gradient is left and it is a shadow rather than a material: a plate
  // prints flat, and every graded fill in the old drawing was a light source.
  const gradients = [...svg.matchAll(/<(linear|radial)Gradient id="([^"]+)"/g)].map((m) => m[2])
  assert.deepEqual(gradients, ['rs-shadow'])
})

test('a window is a socket, a counter, and sometimes somebody sitting at it', () => {
  const svg = citySvg([{ id: 'w', name: 'W', headcount: 6, working: 3 }], { width: 1400, height: 800 })
  assert.match(svg, /class="rs-socket"/, 'no hole')
  assert.match(svg, /class="rs-lip"/, 'no lip inside the hole')
  assert.match(svg, /class="rs-body"/, 'nobody is ever at a window')
  // The figure is drawn from its counter by CSS, so it has to be the counter's
  // next sibling — there is no wrapper around the pair.
  assert.match(svg, /\.rs-w\.rs-busy \+ \.rs-body/)
  // Three floors of six are at work, and work lights from the head down.
  const lit = new Set([...svg.matchAll(/class="rs-w rs-on[^"]*" data-floor="(\d)"/g)].map((m) => m[1]))
  assert.deepEqual([...lit].sort(), ['3', '4', '5'])

  /*
   * And the two classes are two different facts, which they were not.
   *
   * `rs-on` and `rs-busy` used to be stamped on together, always, so the middle
   * state was unreachable and every lit window in the city claimed somebody was
   * sitting at it — on a screen whose own task list said the work had not been
   * picked up. A light on is work in hand; a figure at the window is the
   * building actually running.
   */
  assert.ok(!svg.includes('rs-busy"'), 'a building that is not running claimed somebody was at the desk')

  const running = citySvg([{ id: 'w', name: 'W', headcount: 6, working: 3, busy: true }], {
    width: 1400,
    height: 800,
  })
  const atDesk = new Set(
    [...running.matchAll(/class="rs-w rs-on rs-busy[^"]*" data-floor="(\d)"/g)].map((m) => m[1]),
  )
  assert.deepEqual([...atDesk].sort(), ['3', '4', '5'], 'a running building sat nobody at its lit windows')
})

test('a lit facade uses all three warmths', () => {
  // An earlier form of the expression reduced to `index % 3`, so with a bay
  // count divisible by three every column came out one tone from top to bottom.
  const svg = citySvg([{ id: 'w', name: 'W', headcount: 6, working: 6 }], { width: 1400, height: 800 })
  const tones = new Set([...svg.matchAll(/rs-t(\d)/g)].map((m) => m[1]))
  assert.deepEqual([...tones].sort(), ['0', '1', '2'])
})

test('what waits on the owner is a pin, and it is the only vermilion in the city', () => {
  const waiting = citySvg([{ id: 'a', name: 'A', headcount: 5, waiting: 2 }], { width: 1200, height: 700 })
  const quiet = citySvg([{ id: 'a', name: 'A', headcount: 5 }], { width: 1200, height: 700 })
  assert.match(waiting, /class="rs-waiting"/)
  assert.ok(!quiet.includes('class="rs-waiting"'), 'a building with nothing waiting raised a mark anyway')
  // A post with a ball on top, so shape carries the signal as well as colour
  // does and a colour-blind owner reads it.
  for (const part of ['rs-pin-base', 'rs-pin-post', 'rs-pin-ball']) {
    assert.ok(waiting.includes(part), `the pin has no ${part}`)
  }
  // Placed by one group and rocked by another: a CSS transform replaces the
  // attribute rather than composing with it, and the pin would drop to the
  // pavement the moment it was animated.
  assert.match(waiting, /<g transform="translate\(0 -?[\d.]+\)"><g class="rs-waiting">/)
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

test('every crown and every ornament draws, and none of them draws nothing', () => {
  // The crowns and the ornaments are the wit in the drawing. Sweeping a great
  // many ids is how each one actually gets exercised, and a silently empty
  // `case` is exactly the way one of them would go missing. The counts come off
  // the vocabulary itself so that adding a word to it adds work here too.
  const crowns = new Set<string>()
  const ornaments = new Set<string>()
  for (let i = 0; i < 400; i++) {
    for (const headcount of [1, 2, 3, 5, 9, 13, 19]) {
      const d = design(`sweep-${i}`, headcount)
      crowns.add(d.crown)
      for (const ornament of d.ornaments) ornaments.add(ornament)
      const svg = buildingSvg(d)
      assert.ok(!svg.includes('NaN') && !svg.includes('undefined'), `${d.crown} drew badly`)
      // An empty group is a `case` that fell through and drew nothing at all.
      // The `\s*` is the point: the two plates are joined with newlines, so the
      // old form of this pattern could never match and the guard was decorative
      // for as long as it had been written down.
      assert.ok(!/<g class="rs-crown[^>]*>\s*<\/g>/.test(svg), `the ${d.crown} crown drew nothing`)
      // An ornament that matches no `case` leaves no group behind at all, which
      // is quieter still: the building is simply not carrying the thing it was
      // given.
      for (const ornament of d.ornaments) {
        assert.ok(svg.includes(`rs-o-${ornament}`), `the ${ornament} was never drawn`)
      }
    }
  }
  assert.equal(crowns.size, CROWN_KINDS.length, `only ${crowns.size} crowns are reachable`)
  assert.equal(ornaments.size, ORNAMENTS.length, `only ${ornaments.size} ornaments are reachable`)
  // The decorative one is called a pennant now, so the word cannot be mistaken
  // for the mark that means something is waiting on you.
  assert.ok(ornaments.has('pennant') && !ornaments.has('flag'))
})

// ---- the street ------------------------------------------------------------

test('the street belongs to the city, and a hydrant is not part of any building', () => {
  /*
   * A hydrant, a bare tree in a pit, a steam vent, a subway railing: these stand
   * on the pavement, not on anybody's plot. Seeding them off the city rather
   * than off a building is what keeps decision 0013's promise intact — the
   * building you have not touched in a month is still the one you recognise,
   * however much its neighbour has grown.
   */
  const once = streetFurniture('home', 8)
  const twice = streetFurniture('home', 8)
  assert.deepEqual(twice, once, 'the street was rearranged between two draws of it')

  // Every gap is seeded on its own, so extending the row at one end leaves the
  // other end exactly where it was.
  const longer = streetFurniture('home', 12)
  assert.deepEqual(longer.filter((f) => f.gap < 8), once, 'a new plot moved the furniture down the block')

  // Two cities are two streets.
  const elsewhere = streetFurniture('other-home', 8)
  assert.notDeepEqual(elsewhere, once, 'every city gets the same street')

  const kinds = new Set<string>(STREET_FURNITURE)
  for (const fixture of streetFurniture('big', 60)) {
    assert.ok(kinds.has(fixture.kind), `${fixture.kind} is not street furniture`)
    assert.ok(fixture.at > 0.2 && fixture.at < 0.8, 'a fixture is drawn touching a building')
    assert.ok(Number.isInteger(fixture.gap) && fixture.gap >= 0 && fixture.gap < 60)
  }
})

test('the set pieces on the street are rationed, and the pavement is mostly empty', () => {
  // Furniture in every gap reads as a diagram of a street rather than a street.
  // And a block with four steam vents on it is a fairground.
  for (const city of ['a', 'b', 'c', 'd', 'e']) {
    const gaps = 40
    const placed = streetFurniture(city, gaps)
    assert.ok(placed.length < gaps * 0.7, `${city} paved its whole street with hydrants`)
    const count = (kind: string) => placed.filter((f) => f.kind === kind).length
    assert.ok(count('steam-vent') <= 1, `${city} has ${count('steam-vent')} steam vents`)
    assert.ok(count('subway-entrance') <= 2, `${city} has ${count('subway-entrance')} subway entrances`)
  }
  // A street with no gaps in it is not an error, it is a street with one
  // building on it.
  assert.deepEqual(streetFurniture('empty', 0), [])
  assert.deepEqual(streetFurniture('odd', Number.NaN), [])
  assert.ok(streetFurniture('huge', 1e9).length < 300, 'a wide frame ran the street off the page')
})

test('an empty skyline is still a drawing, and it says what to do about it', () => {
  const svg = citySvg([])
  assert.match(svg, /^<svg /)
  assert.match(svg, /Break ground/)
  assert.match(svg, /Room for another/)
  // The dash is the meaning: nothing here yet. Hover goes to ink and never to
  // the lamp, which means a light is on, and here nothing is.
  assert.match(svg, /\.rs-lot-plot \{[^}]*stroke-dasharray/)
  assert.ok(!/\.rs-lot:hover[^}]*--lamp/.test(svg), 'an empty lot lights up on hover')
})

test('a portrait is one building and no empty lot beside it', () => {
  const svg = portraitSvg({ id: 'solo', name: 'Solo', headcount: 7 })
  assert.match(svg, /^<svg /)
  assert.ok(!svg.includes('Break ground'), 'a portrait offered a second plot')
  // It sits on a card that is already a sheet of paper; a second sheet inside
  // the first is a visible rectangle.
  assert.ok(!svg.includes('class="rs-paper"'), 'a portrait brought its own paper')
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
  // `dust()` and `backdrop()` loop across the whole width, so a runaway one is
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

test('a tower of windows stays inside its node budget', () => {
  // Four shapes per window against one before. Sockets and lips are merged per
  // storey to pay for it; without that a floor of thirty towers is a page the
  // browser has to think about.
  const svg = buildingSvg(design('big', 24), { working: 24 })
  const d = design('big', 24)
  const nodes = (svg.match(/<(rect|path|circle|ellipse)[\s>]/g) ?? []).length
  const budget = d.floors * d.bays * 3 + d.floors * 4 + 220
  assert.ok(nodes < budget, `a ${d.floors}-storey building drew ${nodes} shapes, over ${budget}`)
})

test('the drawing fills the frame it was given, in both directions', () => {
  /*
   * An SVG whose ratio does not match its frame is letterboxed by the browser,
   * and the bars are the page's own background — so the failure looks like a
   * stripe above the roofline and another below the street rather than like a
   * bug. Widening with pavement covered a frame that was relatively wider; a
   * frame that was relatively *taller* had nothing to give, which is the common
   * case: four newsstands on a laptop.
   */
  const ratio = (svg: string) => {
    const box = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
    return Number(box[1]) / Number(box[2])
  }

  const frames = [
    { width: 1440, height: 760 }, // a laptop, which is where this was found
    { width: 1024, height: 900 }, // taller than it is wide, near enough
    { width: 2560, height: 500 }, // a very wide, very short strip
  ]
  const skylines = [
    [{ id: 'a', name: 'A', headcount: 1 }],
    [{ id: 'a', name: 'A', headcount: 2 }, { id: 'b', name: 'B', headcount: 3 }],
    [{ id: 'a', name: 'A', headcount: 9 }, { id: 'b', name: 'B', headcount: 14 }],
  ]

  for (const frame of frames) {
    for (const buildings of skylines) {
      const svg = citySvg(buildings, frame)
      const want = frame.width / frame.height
      const got = ratio(svg)
      // A city too wide for its frame is left alone and scrolls — that is the
      // documented behaviour, and it does not letterbox. Only the other
      // direction, where the drawing is too *narrow*, leaves bars.
      assert.ok(
        got >= want - 0.02,
        `${buildings.length} buildings in ${frame.width}×${frame.height} drew at ${got.toFixed(3)}, ` +
          `narrower than the frame's ${want.toFixed(3)} — that is a letterbox`,
      )
    }
  }
})

test('more room draws the city bigger, and never smaller', () => {
  /*
   * This used to assert the opposite — that the scale was identical whatever
   * height the frame reported — on the reasoning that a building drawn bigger
   * on a taller window is a skyline whose heights cannot be compared with
   * yesterday's.
   *
   * That reasoning was wrong, and it was expensive. Fitting on width alone, a
   * street with an eighteen-storey tower on it came out taller than its frame,
   * and the block that matches the frame's shape had to add pavement until the
   * ratios agreed: a page asking for 1600×620 was handed a sheet 3121 wide with
   * the buildings spanning 1069 of it. A review measured the result at 0.72×,
   * where the misregistration, the socket lip and the figure at the desk are
   * all under one pixel — the three inventions the whole language rests on,
   * below the resolution of the screen it ships on.
   *
   * Heights are compared *within* one drawing, and every building is scaled by
   * the same number, so nothing about that comparison is harmed. What must hold
   * is that more room is never punished, and that the ladder is not rescaled
   * building by building. Both are checked here.
   */
  const city = [
    { id: 'a', name: 'A', headcount: 3 },
    { id: 'b', name: 'B', headcount: 12 },
  ]
  const short = citySvg(city, { width: 1400, height: 400 })
  const tall = citySvg(city, { width: 1400, height: 1000 })
  const heightOf = (svg: string) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1])
  const scaleOf = (svg: string) => Number(svg.match(/class="rs-plot"[^>]*scale\(([\d.]+)\)/)![1])

  assert.ok(heightOf(tall) > heightOf(short), 'a taller frame did not get a taller canvas')
  assert.ok(
    scaleOf(tall) >= scaleOf(short),
    `more room drew the city smaller (${scaleOf(tall)} against ${scaleOf(short)})`,
  )

  // One number for the whole street, in both frames: a fit paid for by scaling
  // buildings against each other would break the one thing the skyline claims.
  for (const svg of [short, tall]) {
    const scales = [...svg.matchAll(/class="rs-plot"[^>]*scale\(([\d.]+)\)/g)].map((m) => m[1])
    assert.equal(new Set(scales).size, 1, 'buildings were scaled against each other')
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

test('a headcount that is not a number is drawn as a newsstand, not as nothing', () => {
  // Math.max passes NaN through, and it reached the page as viewBox="0 0 NaN
  // NaN" — a document that renders as nothing rather than as an error.
  const d = designFor({ id: 'x', name: 'X', headcount: Number.NaN })
  assert.equal(d.floors, 1)
  assert.ok(Number.isFinite(d.height))

  const svg = citySvg([{ id: 'x', name: 'X', headcount: Number.NaN }], { width: 1400, height: 800 })
  assert.ok(!svg.includes('NaN'), 'NaN reached the drawing')
})

test('two buildings whose seeds collide are still two buildings', () => {
  // The seed is a 32-bit hash and these two really do collide. Nothing in the
  // drawing may be keyed on it alone. The pair had to be found again when the
  // ladder was renamed — the form is part of what is hashed, so `b2cir:shack`
  // and `b9kc:single-storey` are not addresses in this city any more.
  assert.equal(seedOf('m0cp:newsstand'), seedOf('aagb:bodega'), 'the collision this guards against')

  const svg = citySvg(
    [{ id: 'm0cp', name: 'One', headcount: 1 }, { id: 'aagb', name: 'Two', headcount: 2 }],
    { width: 1400, height: 800 },
  )
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, ids.length, 'an id was defined twice in one document')
})
