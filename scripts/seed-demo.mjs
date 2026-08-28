/**
 * Build a city worth looking at, in a data directory of its own.
 *
 * A design cannot be judged against one empty shack. This writes a skyline that
 * exercises every state the drawing and the screens have to survive: buildings
 * at every form, floors with work in hand and floors idle, approvals waiting on
 * the owner, finished work with branches behind it, mail in the mailroom, and
 * something in the archives. Nothing here talks to a model — it writes the
 * store directly, so it is instant and free.
 *
 *     node scripts/seed-demo.mjs [home]        # default: .scratch/demo-home
 *
 * Then point a daemon at it:
 *
 *     ROOFSCAPE_HOME=.scratch/demo-home ROOFSCAPE_PORT=7788 node apps/daemon/dist/main.js
 */
import { rm, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const home = resolve(process.argv[2] ?? '.scratch/demo-home')
await rm(home, { recursive: true, force: true })
await mkdir(home, { recursive: true })
process.env.ROOFSCAPE_HOME = home

const { SkylineStore, BuildingStore, ROSTER } = await import('../packages/core/dist/index.js')

const posting = (model = 'claude-opus-5') => ({
  provider: 'anthropic',
  model,
  engine: 'claude-agent-sdk',
})

const charterFor = (role) => ROSTER.find((r) => r.role === role)?.charter ?? `You are the ${role}.`
const nameFor = (role) => ROSTER.find((r) => r.role === role)?.suggestedName ?? role

/**
 * Names are deliberately unlike each other. Two buildings called "Project One"
 * and "Project Two" would hide exactly the variety the skyline is supposed to
 * show.
 */
const CITY = [
  {
    name: 'Help Center',
    charter: 'Answer questions from customers, and keep the answers true as the product moves.',
    workspace: '~/code/help-center',
    staff: ['manager', 'writer', 'researcher', 'coder', 'reviewer', 'curator', 'designer', 'ops',
      'marketer', 'hiring', 'coder', 'writer'],
    working: 4,
    open: ['Rewrite the refunds page so it answers the question people actually ask',
      'Audit every screenshot older than the March redesign',
      'Draft the changelog entry for scheduled exports'],
    done: [
      ['Split the billing article in two', 'branch:help/billing-split'],
      ['Fix the broken anchor links in the setup guide', 'branch:help/anchors'],
      ['Add a search box to the sidebar', 'branch:help/sidebar-search'],
    ],
    approvals: [],
    mail: [
      ['manager', 'owner', 'The refunds rewrite is in hand. I gave it to Iris rather than Ada — it is a writing job, not a product one.'],
      ['owner', 'manager', 'Agreed. Keep the old URL working.'],
    ],
  },
  {
    name: 'Rowing Fans',
    charter: 'The club site: results, the boathouse calendar, and the photographs nobody else will host.',
    workspace: '~/code/rowing-fans',
    staff: ['manager', 'coder', 'reviewer', 'designer', 'ops'],
    working: 0,
    open: ['Make the results table sort by time'],
    done: [['Pad the seconds to two digits', 'branch:rowing/pad-seconds']],
    approvals: [
      'Push branch rowing/results-sort to origin',
      'Deploy the site to production',
      'Spend up to 40,000 tokens finishing the photo importer',
    ],
    mail: [
      ['reviewer', 'owner', 'Sending the sort change back once: it sorts the rendered strings, so 9:59 lands after 10:01.'],
    ],
  },
  {
    name: 'Signal Hill',
    charter: 'The data platform. Everything downstream trusts what comes out of here, so it is slow on purpose.',
    workspace: '~/code/signal-hill',
    staff: ['manager', 'coder', 'coder', 'reviewer', 'ops', 'researcher', 'curator', 'hiring',
      'coder', 'reviewer', 'ops', 'writer', 'designer', 'marketer', 'coder', 'researcher', 'ops', 'manager'],
    working: 6,
    open: ['Backfill the events table for March', 'Cut the nightly job from 40 minutes to 10',
      'Write down what the retention policy actually is'],
    done: [['Stop the loader retrying a poisoned row forever', 'branch:signal/poison-row']],
    approvals: ['Merge signal/poison-row to main'],
    mail: [],
  },
  {
    name: 'Ledger',
    charter: 'Invoicing and the month-end close. Correct beats clever here.',
    workspace: '~/code/ledger',
    staff: ['manager', 'coder', 'reviewer', 'researcher', 'ops', 'curator', 'writer', 'coder'],
    working: 2,
    open: ['Reconcile the March statements'],
    done: [['Round to the cent once, at the end', 'branch:ledger/round-once']],
    approvals: [],
    mail: [],
  },
  {
    name: 'Quad',
    charter: 'The internal tools nobody else wants to own.',
    workspace: '~/code/quad',
    staff: ['manager', 'coder', 'ops'],
    working: 1,
    open: ['Make the on-call rota generator stop scheduling people on leave'],
    done: [],
    approvals: [],
    mail: [],
  },
  {
    name: 'Tin Shed',
    charter: 'Somewhere to try things that are not ready to be seen.',
    workspace: '~/code/tin-shed',
    staff: ['coder'],
    working: 0,
    open: [],
    done: [],
    approvals: [],
    mail: [],
  },
]

const skyline = SkylineStore.open()
skyline.setOwner?.({ name: 'Emilio', profile: 'Runs six buildings. Prefers being told what broke over being told everything is fine.' })

let floors = 0
let tasks = 0

for (const spec of CITY) {
  const building = skyline.breakGround({
    name: spec.name,
    charter: spec.charter,
    workspace: spec.workspace,
    repos: [],
  })

  const store = BuildingStore.open(building.id)
  const hired = spec.staff.map((role, i) =>
    store.hire({
      role,
      name: spec.staff.filter((r) => r === role).length > 1 ? `${nameFor(role)} ${i + 1}` : nameFor(role),
      charter: charterFor(role),
      posting: posting(role === 'manager' || role === 'reviewer' ? 'claude-opus-5' : 'claude-sonnet-5'),
    }),
  )
  floors += hired.length

  const manager = hired.find((f) => f.role === 'manager') ?? hired[0]
  const doers = hired.filter((f) => f.id !== manager.id)
  const pick = (i) => doers[i % Math.max(1, doers.length)] ?? manager

  // Work in hand. `working` floors are the ones the drawing lights up.
  spec.open.forEach((goal, i) => {
    const task = store.assign({ by: manager.id, to: pick(i).id, goal })
    store.setTaskState(task.id, i < spec.working ? 'working' : 'queued')
    tasks++
  })

  spec.done.forEach(([goal, artifact], i) => {
    const task = store.assign({ by: manager.id, to: pick(i + 7).id, goal })
    store.settle(task.id, 'done', {
      summary: `Done. ${goal[0].toLowerCase()}${goal.slice(1)}.`,
      artifacts: [artifact],
    })
    tasks++
  })

  for (const intent of spec.approvals) {
    store.requestApproval({ by: manager.id, intent, detail: null, kind: 'shell' })
  }

  // The owner is not a floor. They are `null`, which is what the mailroom means
  // by "outside the building".
  for (const [from, to, body] of spec.mail) {
    const who = (side) => (side === 'owner' ? null : (hired.find((f) => f.role === side)?.id ?? manager.id))
    store.post({ kind: 'note', from: who(from), to: who(to), body })
  }

  try {
    store.remember({
      scope: 'building',
      layer: 'fact',
      text: `${spec.name} works out of ${spec.workspace}.`,
      source: 'seed',
    })
  } catch {
    // The archives are not what this fixture is for.
  }

  store.close()
  process.stdout.write(`  ${spec.name.padEnd(14)} ${String(hired.length).padStart(2)} floors, ${spec.working} lit, ${spec.approvals.length} waiting\n`)
}

skyline.close()

process.stdout.write(`\nSeeded ${CITY.length} buildings, ${floors} floors, ${tasks} tasks into ${home}\n`)
process.stdout.write(`Run it:  ROOFSCAPE_HOME=${home} ROOFSCAPE_PORT=7788 node apps/daemon/dist/main.js\n`)
