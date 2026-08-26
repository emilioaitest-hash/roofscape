import {
  PROVIDERS, providerSpec, discoverProviders, describePosting, claudeExecutable,
  type Floor, type Posting,
} from '@app/core'
import { openSkyline, openBuilding, findBuilding } from '../context.js'
import { say, dim, bold, tick, note, fail, heading, green } from '../ui.js'

/**
 * Who is running on what, and how to change it.
 *
 * Roofscape picks a sensible model per role, but the point of a chooser is that
 * the owner overrules it. A coder that keeps missing the point can be moved up;
 * a curator that costs too much can be moved down.
 */
export async function post(
  who: string | undefined,
  options: { building?: string; provider?: string; model?: string; engine?: string },
): Promise<void> {
  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)
  const staff = store.staff()

  if (!who) {
    heading(`${building.name} — who is running on what`)
    for (const floor of staff) {
      say(`  ${bold(floor.name.padEnd(10))} ${dim(floor.role.padEnd(11))} ${describePosting(floor.posting)}`)
    }
    say()
    const available = await discoverProviders(skyline)
    say(dim(`  Reachable: ${available.length ? available.join(', ') : 'nothing — run roofscape doctor'}`))
    say()
    say(dim('  Move somebody:  roofscape post Nib --provider openai --model gpt-5'))
    say()
    store.close(); skyline.close()
    return
  }

  const floor = findFloor(staff, who)
  if (!floor) {
    fail(`Nobody here called "${who}".`, `Staff: ${staff.map((f) => f.name).join(', ')}`)
  }

  const provider = options.provider ?? floor.posting.provider
  const spec = providerSpec(provider)
  if (!spec) fail(`No provider called "${provider}".`, `Known: ${PROVIDERS.map((p) => p.name).join(', ')}`)

  const model = options.model ?? (options.provider ? spec.suggested[0] : floor.posting.model)
  if (!model) {
    fail(
      `Which model on ${spec.label}?`,
      spec.suggested.length
        ? `Suggestions: ${spec.suggested.join(', ')}`
        : 'Any model id that provider accepts will do.',
    )
  }

  const engine = resolveEngine(options.engine, provider)
  if (engine === 'claude-agent-sdk' && !claudeExecutable()) {
    fail('That engine needs Claude Code installed, and it is not on this machine.', 'Use --engine direct instead.')
  }

  const next: Posting = { provider, model, engine }
  store.repost(floor.id, next)

  say()
  tick(`${bold(floor.name)} moved.`)
  say(dim(`  was  ${describePosting(floor.posting)}`))
  say(`  ${green('now')}  ${describePosting(next)}`)

  const available = await discoverProviders(skyline)
  if (!available.includes(provider)) {
    note(`${spec.label} is not reachable yet — run: roofscape provider add ${provider}`)
  }
  say()

  store.close()
  skyline.close()
}

const findFloor = (staff: readonly Floor[], who: string): Floor | undefined =>
  staff.find((f) => f.id === who) ??
  staff.find((f) => f.name.toLowerCase() === who.toLowerCase()) ??
  staff.find((f) => f.role === who.toLowerCase())

function resolveEngine(asked: string | undefined, provider: string): Posting['engine'] {
  if (asked === 'claude' || asked === 'claude-agent-sdk') return 'claude-agent-sdk'
  if (asked === 'direct') return 'direct'
  // Unasked: Anthropic goes through Claude Code when it is there, because a
  // subscription carries limits metered billing does not.
  return provider === 'anthropic' && claudeExecutable() ? 'claude-agent-sdk' : 'direct'
}
