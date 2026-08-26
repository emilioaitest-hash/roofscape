import type { FloorRole, Posting } from '../domain/building.js'
import { PROVIDERS, providerSpec } from './catalog.js'

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
  return provider === 'anthropic' && process.env.ROOFSCAPE_CLAUDE_CLI !== 'off'
    ? 'claude-agent-sdk'
    : 'direct'
}

/** Providers with a usable credential, in catalog order. */
export function availableProviders(credentials: { credentialFor(name: string): string | null }): string[] {
  return PROVIDERS.filter((spec) => {
    if (!spec.needsKey) return true
    if (credentials.credentialFor(spec.name)) return true
    return Boolean(spec.envVar && process.env[spec.envVar])
  }).map((spec) => spec.name)
}

export const describePosting = (posting: Posting): string =>
  `${providerSpec(posting.provider)?.label ?? posting.provider} · ${posting.model}${posting.engine === 'claude-agent-sdk' ? ' (via Claude Code)' : ''}`
