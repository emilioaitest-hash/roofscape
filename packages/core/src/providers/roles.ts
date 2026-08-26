import type { FloorRole, Posting } from '../domain/building.js'
import { PROVIDERS, providerSpec } from './catalog.js'
import { claudeExecutable } from '../runtime/claudeEngine.js'

/**
 * What each role wants from a model. A manager is choosing what to do next and
 * wants judgement; a curator is compacting ten thousand notes and wants to be
 * cheap. Routing per role is the difference between a system that costs what it
 * should and one that runs everything on the most expensive thing available.
 */
export type Appetite = 'judgement' | 'code' | 'bulk' | 'general'

export const APPETITE_BY_ROLE: Record<FloorRole, Appetite> = {
  manager: 'judgement',
  hiring: 'judgement',
  reviewer: 'judgement',
  coder: 'code',
  researcher: 'general',
  writer: 'general',
  designer: 'general',
  marketer: 'general',
  ops: 'general',
  curator: 'bulk',
}

/** Best first. A provider absent from the installation is skipped. */
const PREFERENCE: Record<Appetite, ReadonlyArray<[provider: string, model: string]>> = {
  judgement: [
    ['anthropic', 'claude-opus-4-5'],
    ['openai', 'gpt-5'],
    ['google', 'gemini-2.5-pro'],
    ['openrouter', 'anthropic/claude-sonnet-4.5'],
    ['ollama', 'qwen3:8b'],
  ],
  code: [
    ['anthropic', 'claude-sonnet-4-5'],
    ['openai', 'gpt-5'],
    ['deepseek', 'deepseek-chat'],
    ['openrouter', 'anthropic/claude-sonnet-4.5'],
    ['ollama', 'qwen2.5-coder:3b'],
  ],
  general: [
    ['anthropic', 'claude-sonnet-4-5'],
    ['openai', 'gpt-5-mini'],
    ['google', 'gemini-2.5-flash'],
    ['groq', 'llama-3.3-70b-versatile'],
    ['ollama', 'qwen3:8b'],
  ],
  bulk: [
    // Bulk work runs locally by choice: it is the largest volume and the least
    // interesting, so it should not be the largest bill.
    ['ollama', 'qwen3:4b'],
    ['groq', 'llama-3.3-70b-versatile'],
    ['deepseek', 'deepseek-chat'],
    ['anthropic', 'claude-haiku-4-5'],
    ['openai', 'gpt-5-mini'],
  ],
}

/**
 * The posting a role gets when nobody has said otherwise, given what this
 * installation can actually reach.
 */
export function defaultPosting(role: FloorRole, available: readonly string[]): Posting | null {
  const appetite = APPETITE_BY_ROLE[role]
  for (const [provider, model] of PREFERENCE[appetite]) {
    if (available.includes(provider)) {
      return { provider, model, engine: engineFor(provider) }
    }
  }
  return null
}

/**
 * Anthropic runs on the Claude Code engine when it is installed, because a
 * subscription carries higher limits than metered billing and the tools are
 * identical either way.
 */
function engineFor(provider: string): Posting['engine'] {
  if (provider !== 'anthropic') return 'direct'
  if (process.env.ROOFSCAPE_ENGINE === 'direct') return 'direct'
  return claudeExecutable() ? 'claude-agent-sdk' : 'direct'
}

/**
 * Providers that have a usable credential.
 *
 * A local provider is deliberately NOT included here just because it needs no
 * key. "Needs no key" and "is installed and running" are different claims, and
 * treating them as one offers the owner a model that is not there. Local
 * providers are added by `discoverProviders`, which actually asks.
 */
export function availableProviders(credentials: {
  credentialFor(name: string): string | null
}): string[] {
  return PROVIDERS.filter((spec) => {
    if (!spec.needsKey) return false
    if (credentials.credentialFor(spec.name)) return true
    return Boolean(spec.envVar && process.env[spec.envVar])
  }).map((spec) => spec.name)
}

/**
 * Everything actually reachable right now: the credentialled providers, plus
 * any local one that answers. Probes run concurrently and briefly, because this
 * is on the path of every command that has to choose a model.
 */
export async function discoverProviders(credentials: {
  credentialFor(name: string): string | null
}): Promise<string[]> {
  const credentialled = availableProviders(credentials)

  // An installed, logged-in Claude Code is a way to reach Anthropic that needs
  // no API key at all — it spends the owner's subscription instead. Someone who
  // has one should not be told to go and buy metered billing.
  const viaSubscription = claudeExecutable() && !credentialled.includes('anthropic') ? ['anthropic'] : []

  const locals = PROVIDERS.filter((spec) => !spec.needsKey)
  const reachable = await Promise.all(
    locals.map(async (spec) => ((await pingLocal(spec.baseUrl!)) ? spec.name : null)),
  )
  return [...credentialled, ...viaSubscription, ...reachable.filter((name): name is string => name !== null)]
}

async function pingLocal(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1200) })
    return response.ok
  } catch {
    return false
  }
}

export const describePosting = (posting: Posting): string =>
  `${providerSpec(posting.provider)?.label ?? posting.provider} · ${posting.model}${posting.engine === 'claude-agent-sdk' ? ' (via Claude Code)' : ''}`
