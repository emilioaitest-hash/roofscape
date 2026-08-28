/**
 * Draw the city to a file so somebody can look at it.
 *
 * The art is the home screen, and the only way to know whether a change to it
 * helped is to see it. This writes a page with one building of every form, and
 * then several buildings of the *same* form, which is the check that matters:
 * if two buildings the same size look alike, the variety is not working.
 *
 * The page itself is set on Overprint's own paper and ink, because a drawing
 * meant for a warm ground judged against a dark one tells you nothing.
 *
 *     node scripts/city-preview.mjs [out.html]
 */
import { writeFile } from 'node:fs/promises'
import { citySvg, allTiers, designFor } from '../packages/core/dist/skyline/index.js'

const out = process.argv[2] ?? 'city-preview.html'

/** The smallest headcount that reaches each form. */
const LADDER = [1, 2, 3, 5, 8, 12, 18]

const ladder = LADDER.map((headcount, i) => ({
  id: `ladder-${i}`,
  name: allTiers()[i].name.replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()),
  headcount,
  working: i % 3 === 0 ? Math.max(1, Math.floor(headcount / 3)) : 0,
  note: `${headcount} on staff`,
}))

/** Same size, different buildings. This row is the whole argument. */
const sameSize = (headcount, count, tag) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${tag}-${i}-${headcount}`,
    name: `${tag} ${i + 1}`,
    headcount,
    working: i === 1 ? Math.ceil(headcount / 2) : 0,
    note: designFor({ id: `${tag}-${i}-${headcount}`, name: '', headcount }).palette.name,
  }))

const busy = [
  { id: 'busy-a', name: 'Night Shift', headcount: 9, working: 9, busy: true, note: 'everyone in' },
  { id: 'busy-b', name: 'Quiet Co', headcount: 9, working: 0, note: 'nobody in' },
  { id: 'busy-c', name: 'Waiting On You', headcount: 6, working: 2, waiting: 3, note: '3 approvals' },
]

/**
 * The three window states, side by side and nothing else moving.
 *
 * Empty hole, a light left on, somebody at the desk. The whole redesign hangs
 * on those reading apart at a glance, so they get a row of their own where
 * nothing can be blamed on the neighbours.
 */
const states = [
  { id: 'state-dark', name: 'Nobody', headcount: 5, working: 0, note: 'empty holes' },
  { id: 'state-lit', name: 'Lights On', headcount: 5, working: 0, note: 'a light left on' },
  { id: 'state-work', name: 'At It', headcount: 5, working: 5, note: 'somebody in there' },
]

const section = (title, subtitle, buildings, options) => `
  <section>
    <h2>${title} <span>${subtitle}</span></h2>
    <div class="scroll">${citySvg(buildings, options)}</div>
  </section>`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>City preview</title>
<style>
  :root {
    --ground: #F1EBDD; --sunk: #E6DECC; --line: #DCD3BF; --line-strong: #C0B69E;
    --ink: #1E1B16; --ink-2: #494336; --ink-3: #786F5D; --ink-4: #A2987F;
    --lamp: #EFAA22; --lamp-lit: #F7C556; --flag: #D2452A; --flag-deep: #9C2F1B;
    --base: .26s; --slow: .42s; --ease: cubic-bezier(.22,1,.36,1);
    --sans: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    --serif: ui-serif, Georgia, "Times New Roman", serif;
  }
  body { margin: 0; background: var(--ground); color: var(--ink);
         font: 14px/1.5 var(--sans); }
  section { padding: 26px 0 8px; border-bottom: 1px solid var(--line); }
  h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .1em;
       color: var(--ink-3); margin: 0 0 10px; padding: 0 26px; font-weight: 600; }
  h2 span { text-transform: none; letter-spacing: 0; color: var(--ink-4); font-weight: 400; margin-left: 8px; }
  .scroll { overflow-x: auto; }
  /* What the lead will style on the home screen, so the misprint can be judged
     with it snapping and not only sitting still. */
  .rs-plot:hover .rs-plate-colour { transform: none; }
</style></head><body>
${section('The ladder', 'one building of every form, smallest headcount that reaches it', ladder, { emptyLot: false })}
${section('Three states', 'an empty hole, a light left on, somebody at the desk', states, { emptyLot: false })}
${section('Four staff, four buildings', 'same form, same height — nothing else the same', sameSize(4, 6, 'Walk-up'), { emptyLot: false })}
${section('Six staff', 'the cast-iron block, six ways', sameSize(6, 6, 'Ironworks'), { emptyLot: false })}
${section('Ten staff', 'towers', sameSize(10, 5, 'Tower'), { emptyLot: false })}
${section('Twenty staff', 'the top of the ladder', sameSize(20, 4, 'Arcology'), { emptyLot: false })}
${section('At work', 'lit floors, a running goal, and a pin in the roof', busy, {})}
${section('An empty skyline', 'the first thing anyone sees', [], {})}
</body></html>`

await writeFile(out, html)
process.stdout.write(`Wrote ${out}\n`)
