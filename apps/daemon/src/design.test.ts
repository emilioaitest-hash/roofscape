import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * The visual system, enforced.
 *
 * `docs/DESIGN.md` says the app invents no value that is not a token. That is
 * the sort of promise a stylesheet keeps for about three weeks unless something
 * checks — and the failure is quiet: a renamed token makes CSS drop the whole
 * property and inherit, which usually looks *almost* right.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, '..', 'public', 'app.css'), 'utf8')

/** The `:root` block, where values are allowed to be literal. */
const root = css.slice(css.indexOf(':root'), css.indexOf('\n}', css.indexOf(':root')))
const body = css.replace(root, '')

const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:\s*[^;]+;/g)].map((m) => m[1]))

test('every token the stylesheet uses is one it defines', () => {
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))
  const missing = [...used].filter((name) => !defined.has(name)).sort()
  assert.deepEqual(missing, [], 'a var() with no token behind it silently drops the whole property')
})

test('the type scale is the only source of a font size', () => {
  // Seven sizes and nothing between them, per docs/DESIGN.md.
  const raw = [...body.matchAll(/font-size:\s*([^;]+);/g)]
    .map((m) => m[1]!.trim())
    .filter((value) => !value.startsWith('var(--t-') && value !== 'inherit')
  assert.deepEqual(raw, [], `a size off the scale: ${raw.join(', ')}`)
})

test('colour comes from the light and ink tokens, not from a hex nobody named', () => {
  // Eight-digit hexes are allowed: they are a token at partial alpha, which CSS
  // cannot express without repeating the value. Their opaque half must still be
  // a colour the system knows, or white and black, which are not colours here
  // so much as ways of lightening and darkening one.
  const known = new Set(
    [...root.matchAll(/--[a-z0-9-]+:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]!.toLowerCase()),
  )
  // The drawn city's own palette, which core owns and this file only echoes.
  const fromTheDrawing = new Set(['#ffd98d', '#f2ece1', '#e8c15a', '#5865f2'])

  const offenders: string[] = []
  for (const match of body.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    const hex = match[0].toLowerCase()
    if (hex.length === 9) {
      const opaque = hex.slice(0, 7)
      if (opaque === '#ffffff' || opaque === '#000000') continue
      if (known.has(opaque) || fromTheDrawing.has(opaque)) continue
    }
    if (hex.length === 7 && (known.has(hex) || fromTheDrawing.has(hex))) continue
    offenders.push(hex)
  }

  assert.deepEqual(
    [...new Set(offenders)].sort(),
    // Two grounds the metaphor needs and the four-depth scale does not carry:
    // the hatched roof over the cutaway, and the archives, which are below
    // ground and so are darker than anything on the page.
    ['#131118', '#1f1c29', '#24212e', '#2a1206', '#2b2838', '#211f2c'].sort(),
    'a colour that is not in the system',
  )
})

test('nothing is styled with a colour whose meaning is not written down', () => {
  // The rule the whole palette rests on: amber is light, terracotta is you.
  // If either ever appears on an ordinary control the skyline stops meaning
  // anything, because the eye can no longer tell a lit window from a highlight.
  assert.ok(defined.has('--lamp'), 'light')
  assert.ok(defined.has('--flag'), 'you')
  assert.ok(defined.has('--good') && defined.has('--alarm') && defined.has('--cool'))

  // Counting the amber fills was the first shape of this and it was the wrong
  // question — five of them are the lit window in the mark, the lamp on a
  // working floor, and the strip down its edge, all of which *are* light. The
  // rule that actually matters is that amber never fills a neutral control,
  // because that is the moment it stops meaning anything.
  const neutral = ['.ghost', '.pill', '.badge.quiet', '.tab', '.post-who', '.floor-no', '.vital']
  for (const selector of neutral) {
    const rule = body.slice(body.indexOf(`${selector} {`), body.indexOf('}', body.indexOf(`${selector} {`)))
    assert.ok(
      !rule.includes('background: var(--lamp)'),
      `${selector} is filled with amber, which is meant to mean light`,
    )
  }
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

test('the page and its script agree about what exists', () => {
  // A class the stylesheet knows and the page never uses is dead; a class the
  // page uses and the stylesheet has never heard of renders as nothing. The
  // second is the one that ships broken, so it is the one checked.
  const html = readFileSync(join(HERE, '..', 'public', 'index.html'), 'utf8')
  const script = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf8')

  for (const name of ['state', 's-working', 's-blocked', 'k-answer', 'k-task', 'is-working', 'rs-grew']) {
    assert.ok(css.includes(`.${name}`), `${name} is applied but never styled`)
  }
  // And the reverse for the handful that are load-bearing.
  for (const name of ['cutaway', 'cut-band', 'floor-no', 'post-who', 'vital']) {
    assert.ok(
      html.includes(name) || script.includes(name),
      `.${name} is styled but nothing ever applies it`,
    )
  }
})
