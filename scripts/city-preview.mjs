/**
 * Draw the city to a file so somebody can look at it.
 *
 * The art is the home screen, and the only way to know whether a change to it
 * helped is to see it. This writes a page with one building of every form, and
 * then several buildings of the *same* form, which is the check that matters:
 * if two buildings the same size look alike, the variety is not working.
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

const section = (title, subtitle, buildings, options) => `
  <section>
    <h2>${title} <span>${subtitle}</span></h2>
    <div class="scroll">${citySvg(buildings, options)}</div>
  </section>`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>City preview</title>
<style>
  body { margin: 0; background: #0f0e14; color: #e8e3da;
         font: 14px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif; }
  section { padding: 26px 0 8px; border-bottom: 1px solid #ffffff12; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em;
       color: #8f8779; margin: 0 0 10px; padding: 0 26px; font-weight: 600; }
  h2 span { text-transform: none; letter-spacing: 0; color: #5f594f; font-weight: 400; margin-left: 8px; }
  .scroll { overflow-x: auto; }
</style></head><body>
${section('The ladder', 'one building of every form, smallest headcount that reaches it', ladder, { emptyLot: false })}
${section('Four staff, four buildings', 'same form, same height — nothing else the same', sameSize(4, 6, 'Walk-up'), { emptyLot: false })}
${section('Six staff', 'the cast-iron block, six ways', sameSize(6, 6, 'Ironworks'), { emptyLot: false })}
${section('Ten staff', 'towers', sameSize(10, 5, 'Tower'), { emptyLot: false })}
${section('Twenty staff', 'the top of the ladder', sameSize(20, 4, 'Arcology'), { emptyLot: false })}
${section('At work', 'lit floors, a running goal, and something waiting on you', busy, {})}
${section('An empty skyline', 'the first thing anyone sees', [], {})}
</body></html>`

await writeFile(out, html)
process.stdout.write(`Wrote ${out}\n`)
