import { PROVIDERS, providerSpec, probeProvider, discoverProviders, claudeExecutable, curate, BRAND } from '@app/core'
import { openSkyline, openBuilding, findBuilding, where } from '../context.js'
import { say, dim, bold, tick, note, fail, heading, green, red, amber } from '../ui.js'

/** Is everything this needs actually here? Answered before it matters. */
export async function doctor(): Promise<void> {
  const skyline = openSkyline()

  heading('Where things live')
  say(dim(`  ${where()}`))

  heading('Claude Code')
  const binary = claudeExecutable()
  if (binary) {
    say(`  ${green('✓')} found at ${dim(binary)}`)
    note('Anthropic floors will run on your subscription rather than metered billing.')
  } else {
    say(`  ${dim('·')} not installed`)
    note('Install it to run Claude on a subscription instead of per-token billing.')
  }

  heading('Providers')
  const results = await Promise.all(
    PROVIDERS.map(async (spec) => ({ spec, result: await probeProvider(spec.name, skyline) })),
  )
  let usable = 0
  for (const { spec, result } of results) {
    if (result.ok) {
      usable++
      const count = 'models' in result && result.models ? dim(` (${result.models} models)`) : ''
      const how = spec.name === 'anthropic' && !skyline.credentialFor('anthropic') && binary ? dim(' — via your Claude Code subscription') : ''
      say(`  ${green('✓')} ${spec.label}${count}${how}`)
    } else {
      // A provider nobody configured is not a fault; only say so quietly.
      const configured = spec.needsKey && skyline.credentialFor(spec.name)
      if (configured) {
        say(`  ${red('✗')} ${spec.label} — ${result.reason}`)
        note(result.remedy)
      } else {
        say(`  ${dim('·')} ${spec.label} ${dim('— not set up')}`)
      }
    }
  }

  heading('Verdict')
  if (usable === 0) {
    say(`  ${amber('No provider is reachable, so no agent can run yet.')}`)
    note('Add one:  roofscape provider add anthropic')
  } else {
    tick(`${usable} provider${usable === 1 ? '' : 's'} reachable. ${BRAND.name} can work.`)
  }
  say()
  skyline.close()
}

/** Add or change a provider credential. */
export async function providerAdd(name: string | undefined, options: { key?: string; env?: string }): Promise<void> {
  const skyline = openSkyline()

  if (!name) {
    heading('Providers you can add')
    for (const spec of PROVIDERS) {
      const has = skyline.credentialFor(spec.name) ? green(' (set up)') : ''
      say(`  ${bold(spec.name.padEnd(12))} ${dim(spec.note)}${has}`)
    }
    say()
    say(dim('  roofscape provider add anthropic --env ANTHROPIC_API_KEY'))
    say(dim('  roofscape provider add anthropic --key sk-ant-...'))
    say()
    skyline.close()
    return
  }

  const spec = providerSpec(name)
  if (!spec) fail(`No provider called "${name}".`, `Known: ${PROVIDERS.map((p) => p.name).join(', ')}`)

  if (!spec.needsKey) {
    skyline.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'none', credential: null })
    tick(`${spec.label} recorded. It needs no key.`)
    skyline.close()
    return
  }

  // Preferring an environment variable is not fussiness: it keeps the secret out
  // of the database, so a building folder can be copied or backed up without
  // carrying the key along with it.
  const envVar = options.env ?? (options.key ? null : spec.envVar)
  if (envVar) {
    skyline.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'env', credential: envVar })
    const present = Boolean(process.env[envVar])
    tick(`${spec.label} will read ${bold(envVar)} from the environment.`)
    if (!present) note(`${envVar} is not set right now, so it will not work until it is.`)
  } else if (options.key) {
    skyline.putProvider({ name: spec.name, baseUrl: spec.baseUrl ?? null, credentialKind: 'literal', credential: options.key })
    tick(`${spec.label} set up.`)
    note('The key is stored in your data directory. --env keeps it out of there instead.')
  }

  const reachable = await discoverProviders(skyline)
  note(reachable.includes(spec.name) ? 'Checked: it answers.' : 'Not answering yet — try: roofscape doctor')
  say()
  skyline.close()
}

/** Read the archives. */
export function archives(query: string | undefined, options: { building?: string }): void {
  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)

  const records = query ? store.recallByKeyword(query, { limit: 20 }) : store.pinned(null)
  heading(query ? `Archives matching "${query}"` : `${building.name} — pinned`)

  if (records.length === 0) {
    say(dim(query ? '  Nothing found.' : '  Nothing pinned yet.'))
  } else {
    for (const record of records) {
      const scope = record.scope === 'floor' ? (store.floor(record.floor!)?.name ?? 'a floor') : record.scope
      say(`  ${dim(`[${record.layer}·${scope}]`)} ${record.text}`)
      if (record.useCount > 0) say(dim(`      recalled ${record.useCount}x`))
    }
  }
  say()
  say(dim(`  ${store.memoryCount().toLocaleString()} notes in total.`))
  say()
  store.close()
  skyline.close()
}

/** Send the curator down to the archives. */
export async function curateArchives(options: { building?: string }): Promise<void> {
  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)

  const stats = store.archiveStats()
  if (stats.total === 0) {
    say()
    note(`${building.name} has nothing in its archives yet. Nothing to tidy.`)
    say()
    store.close(); skyline.close()
    return
  }

  heading(`${building.name} — archives`)
  say(dim(`  ${stats.total} notes · ${stats.pinned} pinned · ${stats.expired} expired`))
  say()
  say(dim('  The curator is reading…'))

  const available = await discoverProviders(skyline)
  const result = await curate({ building, store, credentials: skyline, available })

  say()
  say(`  ${result.summary}`)
  say()
  const change = result.after - result.before
  tick(
    change === 0
      ? `${result.after} notes, unchanged in number.`
      : `${result.before} notes → ${result.after} (${change > 0 ? '+' : ''}${change}).`,
  )
  note(`${result.tokensSpent.toLocaleString()} output tokens spent.`)
  say()

  store.close()
  skyline.close()
}
