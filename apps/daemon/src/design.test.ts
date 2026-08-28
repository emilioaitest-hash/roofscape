import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Overprint, enforced.
 *
 * The design doc says the app invents no value that is not a token, and that
 * nothing is decorative. Those are the sort of promises a stylesheet keeps for
 * about three weeks unless something checks — and the failures are quiet: a
 * renamed token makes CSS drop the whole property and inherit, which usually
 * looks *almost* right, and a marigold button looks *better* until you notice
 * you can no longer tell a lit window from a highlight.
 *
 * The load-bearing test in this file is `a meaning colour never fills a
 * control`. Everything else is hygiene; that one is the city's argument.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, '..', 'public', 'app.css'), 'utf8')
const html = readFileSync(join(HERE, '..', 'public', 'index.html'), 'utf8')
const script = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf8')

/** Comments carry examples of what not to do, so they are never read as CSS. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The `:root` block, the one place a literal value is allowed. */
const root = bare.slice(bare.indexOf(':root'), bare.indexOf('\n}', bare.indexOf(':root')))
const body = bare.replace(root, '')

const defined = new Set([...bare.matchAll(/(--[a-z0-9-]+)\s*:\s*[^;]+;/g)].map((m) => m[1]!))

/** What each token is literally set to, for following one var() to its value. */
const values = new Map(
  [...root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
)

/**
 * Every rule in the file as a selector and its declarations.
 *
 * A flat scan rather than a parser: an `@media` wrapper never matches, because
 * its body contains a `{` before its `}`, so the rules inside it are found on
 * their own. That is exactly what is wanted — a rule is a rule wherever it is
 * nested, and nothing here cares which breakpoint it sits under.
 */
interface Rule { selector: string; declarations: string }
const rules: Rule[] = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim(),
  declarations: m[2]!,
}))

/** One declaration out of a rule, or '' — the last one wins, as in CSS. */
function declared(rule: Rule, property: string): string {
  const found = [...rule.declarations.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))]
  return found.length ? found[found.length - 1]![1]!.trim() : ''
}

/** A value with its `var()`s replaced by what they are set to, a few deep. */
function resolve(value: string): string {
  let out = value
  for (let pass = 0; pass < 4 && out.includes('var('); pass += 1) {
    out = out.replace(/var\((--[a-z0-9-]+)\)/g, (whole, name: string) => values.get(name) ?? whole)
  }
  return out.toLowerCase()
}

test('every token the stylesheet uses is one it defines', () => {
  const used = new Set([...bare.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))
  const missing = [...used].filter((name) => !defined.has(name)).sort()
  assert.deepEqual(missing, [], 'a var() with no token behind it silently drops the whole property')
})

test('the type scale is the only source of a font size', () => {
  // Seven sizes and nothing between them.
  const raw = [...body.matchAll(/font-size:\s*([^;]+);/g)]
    .map((m) => m[1]!.trim())
    .filter((value) => !value.startsWith('var(--t-') && value !== 'inherit')
  assert.deepEqual(raw, [], `a size off the scale: ${raw.join(', ')}`)
})

test('every colour outside :root is a token, or white and black at alpha', () => {
  // Eight-digit hexes would be a token at partial alpha, which CSS cannot
  // express without repeating the value — but `color-mix()` can, and does,
  // everywhere in this file. So the only literals left ought to be none.
  const offenders: string[] = []
  for (const match of body.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    const hex = match[0].toLowerCase()
    const opaque = hex.length === 9 ? hex.slice(0, 7) : hex
    if (opaque === '#ffffff' || opaque === '#000000') continue
    offenders.push(hex)
  }
  assert.deepEqual([...new Set(offenders)].sort(), [], 'a colour that is not in the system')
})

test('a meaning colour never fills a control', () => {
  /*
   * The rule the whole product rests on, in its mechanical form.
   *
   * Marigold means light and vermilion means you. The moment either fills an
   * ordinary control, the eye can no longer tell a lit window from a highlight
   * and the city stops meaning anything — which is the exact failure the app
   * shipped with, three times over: an amber `.solid`, an amber focus ring and
   * an amber `accent-color`.
   *
   * A mark is not a control: `.badge` counts what is waiting on you and is
   * allowed to be vermilion, and a lamp is allowed to be lamp-coloured. What is
   * checked is anything a person presses or types into.
   */
  assert.ok(defined.has('--lamp') && defined.has('--lamp-lit'), 'light')
  assert.ok(defined.has('--flag') && defined.has('--flag-deep'), 'you')
  assert.ok(defined.has('--good') && defined.has('--alarm') && defined.has('--cool'))

  const meaning = ['--lamp', '--lamp-lit', '--flag', '--flag-deep']
    .map((name) => values.get(name)!.toLowerCase())
  const controls = /(^|[\s,>+~])(button|input|select|textarea)\b|\.solid|\.ghost|\.chip|\.tab\b/

  const guilty: string[] = []
  for (const rule of rules) {
    if (!controls.test(rule.selector)) continue
    for (const property of ['background', 'background-color', 'background-image']) {
      const fill = resolve(declared(rule, property))
      if (meaning.some((hex) => fill.includes(hex))) guilty.push(`${rule.selector} { ${property}: ${fill} }`)
    }
  }
  assert.deepEqual(guilty, [], 'a control filled with a colour that is supposed to mean something')
})

test('the primary button is ink', () => {
  // The single rule most likely to be "improved" later, so it is asserted by
  // name rather than inferred from the one above it.
  const solid = rules.find((rule) => rule.selector === '.solid')
  assert.ok(solid, 'there is no .solid rule at all')
  assert.equal(declared(solid, 'background'), 'var(--ink)', 'the primary button is not ink')

  // The other two places amber used to leak into ordinary chrome.
  assert.match(root, /accent-color:\s*var\(--ink\)/, 'accent-color is not ink')
  const ring = rules.find((rule) => rule.selector.includes('button:focus-visible'))
  assert.ok(ring && resolve(declared(ring, 'box-shadow')).includes(values.get('--ink')!.toLowerCase()),
    'the focus ring is not ink')
})

test('space and shape come off the scale', () => {
  const spaceProperty = /\b(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left|-inline|-block)?\s*:\s*([^;}]+)/g
  const offSpace: string[] = []
  for (const match of body.matchAll(spaceProperty)) {
    // Tokens and calc/min/max wrappers are taken out first; a length left in
    // what remains is a number somebody measured rather than chose.
    const left = match[3]!
      .replace(/var\(--s[1-9]\)/g, ' ')
      .replace(/\b(calc|min|max|clamp)\([^)]*\)/g, ' ')
    if (/-?\d*\.?\d+(px|rem|em|ch|vh|vw)/.test(left)) offSpace.push(`${match[1]}${match[2] ?? ''}: ${match[3]!.trim()}`)
  }
  assert.deepEqual([...new Set(offSpace)].sort(), [], 'a space value that is not on the scale')

  const offShape = [...body.matchAll(/border-radius:\s*([^;}]+)/g)]
    .map((m) => m[1]!.trim())
    .filter((value) => !/^var\(--r-(control|surface|pill)\)$/.test(value) && value !== '0')
  assert.deepEqual([...new Set(offShape)].sort(), [], 'a radius that is not one of the three')
})

test('the hint weight never carries a sentence', () => {
  // `--ink-4` is for timestamps and hints. At 15.5px on warm paper it is not
  // contrast enough to read prose in, so a rule that sets it has to be setting
  // a small size in the same breath.
  const guilty = rules
    .filter((rule) => /(^|;)\s*color:\s*var\(--ink-4\)/.test(rule.declarations))
    .filter((rule) => !/font-size:\s*var\(--t-(micro|plate)\)/.test(rule.declarations))
    .map((rule) => rule.selector)
  assert.deepEqual(guilty, [], 'a sentence set in the hint weight')
})

test('the misregistration snaps into register under the pointer', () => {
  /*
   * The one interaction the whole design language is built on: every building
   * is printed twice, the colour plate lands off the ink, and pointing at one
   * pulls it into register. It is two rules and it is the best thing in the
   * app, which is precisely why it is the sort of thing that gets tidied away
   * by somebody who does not know what it is for.
   */
  const snap = rules.find((rule) => /\.rs-plot:hover\s+\.rs-plate-colour/.test(rule.selector))
  assert.ok(snap, 'hovering a building no longer snaps its colour plate into register')
  assert.equal(declared(snap, 'transform'), 'none')

  const plate = rules.find((rule) => rule.selector === '.rs-plate-colour')
  assert.ok(plate && declared(plate, 'transition').includes('var(--base)'), 'the snap is not timed')
})

test('the app carries its own typefaces', () => {
  // Roofscape runs on your machine, often with no network. A design language
  // that needs fonts.googleapis.com to look right is not a design language.
  const faces: ReadonlyArray<readonly [string, string]> = [
    ['Fraunces', 'fonts/fraunces.woff2'],
    ['Instrument Sans', 'fonts/instrument-sans.woff2'],
    ['IBM Plex Mono', 'fonts/plex-mono.woff2'],
  ]
  for (const [family, file] of faces) {
    assert.ok(css.includes(`font-family: '${family}'`), `${family} is not declared`)
    assert.ok(css.includes(file), `${family} is not served from this install`)
  }
  // Against the comment-stripped copy: the note above the block explains why
  // the faces are vendored, and naming the host it is avoiding is the point.
  assert.ok(!/@import|fonts\.googleapis|fonts\.gstatic/.test(bare), 'the stylesheet reaches for the network')
})

test('a person who asked for less motion gets less motion', () => {
  assert.match(css, /prefers-reduced-motion/, 'no reduced-motion block at all')
  const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion'))
  assert.match(block, /animation-duration:\s*\.001ms\s*!important/)
  assert.match(block, /transition-duration:\s*\.001ms\s*!important/)
  // The parallax is a transform set from script, so clearing the transition is
  // not enough — the transform itself has to go.
  assert.match(block, /transform:\s*none\s*!important/)
})

test('the number printed on a tab is the key that reaches it', () => {
  /*
   * Three places have to agree: the digit set on the tab like a lift button,
   * that tab's position in the bar, and the order of `TABS` in the script,
   * which is what a keystroke is looked up in. Any two of them can drift apart
   * silently — the tab still works when clicked, so nothing looks broken, and
   * the only symptom is that pressing 4 opens the wrong room.
   */
  // Searched from the opening tag, not from the top of the file: the crumbs in
  // the header are a <nav> too, and they close before this one opens.
  const from = html.indexOf('<nav class="tabs"')
  const bar = html.slice(from, html.indexOf('</nav>', from))
  // `data-tab` is no longer the last attribute on the button — aria-selected,
  // aria-controls and tabindex now follow it — so the number is not necessarily
  // the next thing after the closing bracket. Anything but a bracket may sit
  // between them.
  const tabs = [...bar.matchAll(/data-tab="([a-z]+)"[^>]*><b>(\d)<\/b>/g)].map((m) => ({
    tab: m[1]!,
    plate: Number(m[2]),
  }))
  assert.ok(tabs.length >= 6, `only ${tabs.length} tabs carry a number`)

  for (const [index, { tab, plate }] of tabs.entries()) {
    assert.equal(plate, index + 1, `"${tab}" is ${index + 1}th in the bar but wears a ${plate}`)
  }

  const listed = script.match(/const TABS = \[([^\]]+)\]/)
  assert.ok(listed, 'the script no longer has a TABS list for a keystroke to look up')
  const order = [...listed[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(
    order,
    tabs.map((t) => t.tab),
    'pressing a number would open a different tab from the one wearing it',
  )
})

test('the page and its script agree about what exists', () => {
  // A class the stylesheet knows and the page never uses is dead; a class the
  // page uses and the stylesheet has never heard of renders as nothing. The
  // second is the one that ships broken, so it is the one checked.
  for (const name of [
    'state', 's-working', 's-blocked', 'k-answer', 'k-task', 'is-working', 'rs-grew',
    'tally-n', 'notice-fix', 'next-say', 'blocked-where',
  ]) {
    assert.ok(css.includes(`.${name}`), `${name} is applied but never styled`)
  }
  // And the reverse for the handful that are load-bearing.
  for (const name of ['cutaway', 'cut-band', 'floor-no', 'post-who', 'vital', 'tally-n', 'notice-what']) {
    assert.ok(
      html.includes(name) || script.includes(name),
      `.${name} is styled but nothing ever applies it`,
    )
  }
})

test('the strip always names the next action, and never shows a row of zeros', () => {
  /*
   * The fault the owner's own instance is parked in. The welcome panel used to
   * appear only when `buildings.length === 0`, so one building with nobody in
   * it fell through to four zeros and "Click a building to go inside it".
   *
   * Checked at the two points where it could silently regress: the strip is a
   * state machine with a branch for an empty building, and a tally of nothing
   * is not drawn.
   */
  assert.match(script, /function paintNext\(/, 'the strip no longer decides what comes next')

  // The strip is driven by the daemon's own `next`, computed in the one place
  // that can see every building at once, rather than re-derived here from a
  // partial view. The page's job is the wording; the state machine is not its
  // to reimplement, and the copy that used to live here was missing the branch
  // a fresh install is actually in.
  assert.match(script, /next\?\.do/, 'the strip is no longer driven by the daemon it asked')

  for (const [branch, why] of [
    ['connect-provider', 'a fresh install, with no credential anywhere, is not recognised'],
    ['break-ground', 'an empty skyline is not recognised'],
    ['hire', 'a building with nobody in it is not recognised — the fault this test exists for'],
  ] as const) {
    assert.ok(script.includes(`case '${branch}'`), why)
  }

  assert.match(
    script,
    /Take somebody on/,
    'the strip can no longer tell an owner to hire, which is the only thing that makes a building work',
  )
  assert.match(script, /value \?[^:]*tally/, 'a tally of zero is drawn again')
})

test('nothing shows a person an identifier this code passes between its own functions', () => {
  // `awaiting-review` is the *normal* outcome of a successful task in a
  // building with no reviewer, and it used to reach the owner raw, in a red
  // pill. Every state the API can send has a phrase.
  for (const state of [
    'queued', 'working', 'awaiting-review', 'awaiting-approval', 'done', 'escalated', 'abandoned',
  ]) {
    assert.ok(
      new RegExp(`'?${state}'?\\s*:`).test(script.slice(script.indexOf('const TASK_SAID'))),
      `${state} has no words a person would use`,
    )
  }
  assert.ok(script.includes("'awaiting-review': 'waiting to be read'"), 'the phrase for the commonest state')
})
