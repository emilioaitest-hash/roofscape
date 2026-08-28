import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import {
  ROSTER, rosterFor, FOUNDING_ROLES, defaultPosting, discoverProviders, describePosting,
  tierOf, nextTierAt, TOOLS_FOR_ROLE, isRepo, type FloorRole,
} from '@app/core'
import { openSkyline, openBuilding, findBuilding } from '../context.js'
import { say, dim, bold, tick, note, fail, heading, green, amber } from '../ui.js'

/** Break ground on a new building. */
export async function breakGround(name: string | undefined, options: { charter?: string; workspace?: string }): Promise<void> {
  if (!name) fail('What is it called?', 'roofscape ground "My Project" --workspace ~/code/my-project')

  const workspace = resolve(options.workspace ?? process.cwd())
  if (!existsSync(workspace)) fail(`No such directory: ${workspace}`, 'Make it first, or point --workspace somewhere that exists.')

  const skyline = openSkyline()
  if (skyline.byName(name)) fail(`There is already a building called "${name}".`)

  const charter = options.charter ?? `${name}. (No charter written yet — set one with: roofscape charter "…")`
  const building = skyline.breakGround({ name, charter, workspace, repos: isRepo(workspace) ? [workspace] : [] })
  const store = openBuilding(building.id)

  const available = await discoverProviders(skyline)
  if (available.length === 0) {
    say()
    say(amber('Broken ground, but there is no model provider set up yet.'))
    note('Add one:  roofscape provider add anthropic')
  }

  const hired: string[] = []
  for (const role of FOUNDING_ROLES) {
    const entry = rosterFor(role)!
    const posting = defaultPosting(role, available)
    if (!posting) continue
    store.hire({
      role, name: entry.suggestedName, charter: entry.charter, posting,
      tools: TOOLS_FOR_ROLE[role] ?? [],
    })
    hired.push(`${entry.suggestedName} (${role})`)
  }

  say()
  tick(`${bold(building.name)} — ground broken at ${dim(workspace)}`)
  if (hired.length > 0) {
    note(`Started with ${hired.join(' and ')}.`)
    note(`Running on ${describePosting(defaultPosting('manager', available)!)}.`)
  }
  say()
  say(dim('  Next:'))
  say(`      ${bold(`roofscape goal "..." --building ${building.id}`)}`)
  say(dim('      …or take on a reviewer first, so the work gets read:'))
  say(`      ${bold(`roofscape hire reviewer --building ${building.id}`)}`)
  say()

  store.close()
  skyline.close()
}

/** Take on a new member of staff. The building grows a floor. */
export async function hire(role: string | undefined, options: { building?: string; name?: string }): Promise<void> {
  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)

  if (!role) {
    heading('Who can you hire')
    for (const entry of ROSTER) {
      say(`  ${bold(entry.role.padEnd(11))} ${dim(entry.summary)}`)
    }
    say()
    say(dim(`  roofscape hire coder --building ${building.id}`))
    say()
    store.close(); skyline.close()
    return
  }

  const entry = rosterFor(role as FloorRole)
  if (!entry) fail(`There is no such role as "${role}".`, `Known roles: ${ROSTER.map((r) => r.role).join(', ')}`)

  const available = await discoverProviders(skyline)
  const posting = defaultPosting(entry.role, available)
  if (!posting) {
    fail(
      `No model provider is set up that suits a ${entry.role}.`,
      'Add one:  roofscape provider add anthropic',
    )
  }

  const before = store.headcount()
  const floor = store.hire({
    role: entry.role,
    name: options.name ?? entry.suggestedName,
    charter: entry.charter,
    posting,
    tools: TOOLS_FOR_ROLE[entry.role] ?? [],
  })
  const after = store.headcount()

  say()
  tick(`${bold(floor.name)} joins ${building.name} as ${entry.role} — floor ${after}`)
  note(describePosting(posting))

  const wasTier = tierOf(before).name
  const nowTier = tierOf(after)
  if (before > 0 && wasTier !== nowTier.name) {
    say()
    say(green(`  ${building.name} is now a ${nowTier.name}.`))
    say(dim(`  ${nowTier.blurb}`))
  } else {
    const next = nextTierAt(after)
    if (next !== null) note(`${next - after} more and it becomes a ${tierOf(next).name}.`)
  }
  say()

  store.close()
  skyline.close()
}

/**
 * Somebody leaves, and the building gets shorter.
 *
 * Height is headcount, and until now height only went up: `vacate` existed on
 * the store from the first commit with no command and no route behind it, so a
 * mis-hire was permanently built into the skyline.
 */
export function vacate(who: string | undefined, options: { building?: string }): void {
  if (!who) fail('Who is leaving?', 'roofscape vacate Pitch --building my-project')

  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)

  const needle = who.toLowerCase()
  const staff = store.staff()
  const floor =
    staff.find((f) => f.id === who) ??
    staff.find((f) => f.name.toLowerCase() === needle) ??
    staff.find((f) => f.role === needle)
  if (!floor) {
    store.close(); skyline.close()
    fail(`Nobody called "${who}" works at ${building.name}.`, `On staff: ${staff.map((f) => f.name).join(', ') || 'nobody'}`)
  }

  const heldBy = store.claimHolder()
  if (heldBy !== null) {
    store.close(); skyline.close()
    fail(`${building.name} is being worked on (${heldBy}).`, 'Let it finish first — a floor cannot leave mid-task.')
  }

  const before = store.headcount()
  const { handedBack } = store.vacate(floor.id)
  const after = store.headcount()

  say()
  tick(`${bold(floor.name)} has left ${building.name} — ${after} floor${after === 1 ? '' : 's'}, was ${before}`)
  note('Nothing was deleted. Their record and their notes stay in the archives.')
  if (handedBack > 0) {
    note(`${handedBack} unfinished task${handedBack === 1 ? '' : 's'} came back to the desk.`)
  }
  if (before > 0 && after > 0 && tierOf(before).name !== tierOf(after).name) {
    say(dim(`  ${building.name} is a ${tierOf(after).name} again.`))
  }
  if (!store.floorByRole('manager')) {
    say()
    say(amber(`  ${building.name} has no manager now, so it cannot be given a goal.`))
    note(`Hire one:  roofscape hire manager --building ${building.id}`)
  }
  say()

  store.close()
  skyline.close()
}

/** Set what a building is for. */
export function setCharter(text: string | undefined, options: { building?: string }): void {
  if (!text) fail('What is this building for?', 'roofscape charter "We build and run the college app."')
  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)
  // The charter is read by every floor on every turn, so it lives on the
  // building record rather than in the archives.
  skyline.setSetting(`charter:${building.id}`, text)
  store.remember({ scope: 'building', layer: 'semantic', text: `What this building is for: ${text}`, pinned: true, source: 'the owner' })
  tick(`Charter set for ${building.name}.`)
  store.close()
  skyline.close()
}
