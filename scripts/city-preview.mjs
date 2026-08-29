/**
 * Draw the city to a file so somebody can look at it.
 *
 * The art is the home screen, and the only way to know whether a change to it
 * helped is to see it. This writes a page with one building of every form, and
 * then several buildings of the *same* form, which is the check that matters:
 * if two buildings the same size look alike, the variety is not working.
 *
 * There is also a row of the same street at the width the home screen actually
 * hands it, in a box that shape, because a drawing judged at its natural size
 * tells you nothing about whether it fills the frame it ships in — which is how
 * the city came to be drawn at 0.69× and marooned in four hundred pixels of
 * empty paper on either side without anybody noticing.
 *
 * The page itself is set on Overprint's own paper and ink, because a drawing
 * meant for a warm ground judged against a dark one tells you nothing either.
 *
 *     node scripts/city-preview.mjs [out.html]
 */
import { writeFile } from 'node:fs/promises'
import { citySvg, allTiers, designFor } from '../packages/core/dist/skyline/index.js'

const out = process.argv[2] ?? 'city-preview.html'

/** The smallest headcount that reaches each form. */
const LADDER = [1, 2, 3, 5, 8, 12, 18]

const title = (name) => name.replace(/(^|[\s-])\w/g, (c) => c.toUpperCase())

const ladder = LADDER.map((headcount, i) => ({
  id: `ladder-${i}`,
  name: title(allTiers()[i].name),
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
 * What a window means, side by side and nothing else moving.
 *
 * An empty hole, some of the floors at work, all of them. The whole redesign
 * hangs on those reading apart at a glance, so they get a row of their own
 * where nothing can be blamed on the neighbours.
 *
 * There used to be a fourth here called *a light left on*, drawn with
 * `working: 0` and expected to come out lit — which it did, because a sixteen
 * percent scatter of every facade in the city was lit whatever anybody was
 * doing. It came out identical to *nobody* the moment marigold started meaning
 * something, which is the correct answer and worth having said out loud.
 */
const states = [
  { id: 'state-dark', name: 'Nobody', headcount: 6, working: 0, note: 'six empty holes' },
  { id: 'state-some', name: 'Two On It', headcount: 6, working: 2, note: 'lit from the top down' },
  { id: 'state-work', name: 'All Hands', headcount: 6, working: 6, note: 'every floor at work' },
]

const section = (title, subtitle, buildings, options) => `
  <section>
    <h2>${title} <span>${subtitle}</span></h2>
    <div class="scroll">${citySvg(buildings, options)}</div>
  </section>`

/**
 * The same street, in a box the shape of the home screen's frame.
 *
 * The page hands `citySvg` its own width and height and then scales the drawing
 * to fill the frame. Judged at natural size that step is invisible, so this
 * puts the drawing in a hole the right shape and lets it do what it will
 * actually do — which is the only view that can tell you whether the buildings
 * are filling their frame or sitting in the middle of it.
 */
const framed = (title, subtitle, buildings, frame) => `
  <section>
    <h2>${title} <span>${subtitle}</span></h2>
    <div class="frame" style="width:${frame.width / 2}px;height:${frame.height / 2}px">
      ${citySvg(buildings, { ...frame, city: 'preview' })}
    </div>
  </section>`

const home = [
  { id: 'home-a', name: 'Help Center', headcount: 4, working: 2, note: '2 in hand' },
  { id: 'home-b', name: 'Signal Hill', headcount: 9, working: 0, note: 'nobody in' },
  { id: 'home-c', name: 'Dockside', headcount: 2, working: 1, waiting: 1, note: '1 waiting' },
  { id: 'home-d', name: 'Kiln', headcount: 13, working: 4, busy: true, note: '4 in hand' },
  { id: 'home-e', name: 'Ledger', headcount: 6, working: 0, note: 'nobody in' },
  { id: 'home-f', name: 'Orchard', headcount: 1, working: 0, note: 'nobody in yet' },
]

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
  .frame { margin: 0 26px; overflow: hidden; border: 1px solid var(--line-strong); }
  .frame svg { width: 100%; height: 100%; display: block; }
  /* What the lead will style on the home screen, so the misprint can be judged
     with it snapping and not only sitting still. */
  .rs-plot:hover .rs-plate-colour { transform: none; }
</style></head><body>
${framed('The home screen', 'six buildings in the frame the page actually gives them', home, { width: 2720, height: 1400 })}
${section('The ladder', 'one building of every form, smallest headcount that reaches it', ladder, { emptyLot: false })}
${section('What a window means', 'an empty hole, some floors at work, all of them', states, { emptyLot: false })}
${section('Four staff, four buildings', 'same form, same height — nothing else the same', sameSize(4, 6, 'Brownstone'), { emptyLot: false })}
${section('Six staff', 'the cast-iron loft, six ways', sameSize(6, 6, 'Ironworks'), { emptyLot: false })}
${section('Ten staff', 'setback towers', sameSize(10, 5, 'Tower'), { emptyLot: false })}
${section('Twenty staff', 'the top of the ladder', sameSize(20, 4, 'Supertall'), { emptyLot: false })}
${section('At work', 'lit floors, a running goal, and a pin in the roof', busy, {})}
${section('An empty skyline', 'the first thing anyone sees', [], {})}
</body></html>`

await writeFile(out, html)
process.stdout.write(`Wrote ${out}\n`)
