import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { providerSpec, type ProviderSpec } from './catalog.js'
import type { Posting } from '../domain/building.js'

/** Where a key comes from. The store implements this; tests can fake it. */
export interface Credentials {
  credentialFor(provider: string): string | null
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** What the owner should actually do about it. */
    readonly remedy: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * Turn a posting into something that can be called.
 *
 * A missing key fails here, with the name of the environment variable that
 * would fix it, rather than three layers down inside a request.
 */
export function resolveLanguageModel(posting: Posting, credentials: Credentials): LanguageModel {
  const spec = providerSpec(posting.provider)
  if (!spec) {
    throw new ProviderError(
      `Unknown provider "${posting.provider}".`,
      posting.provider,
      `Known providers: ${knownNames()}.`,
    )
  }

  const key = resolveKey(spec, credentials)
  if (spec.needsKey && !key) {
    throw new ProviderError(
      `No credential for ${spec.label}.`,
      spec.name,
      spec.envVar
        ? `Set ${spec.envVar} in the environment, or run: roofscape provider add ${spec.name}`
        : `Run: roofscape provider add ${spec.name}`,
    )
  }

  // Passing `apiKey: undefined` and omitting it are different things to these
  // constructors: the first overrides their own environment lookup with nothing.
  const settings = key === null ? {} : { apiKey: key }

  switch (spec.kind) {
    case 'anthropic':
      return createAnthropic(settings)(posting.model)
    case 'openai':
      return createOpenAI(settings)(posting.model)
    case 'google':
      return createGoogleGenerativeAI(settings)(posting.model)
    case 'openai-compatible':
      return createOpenAICompatible({
        name: spec.name,
        baseURL: spec.baseUrl!,
        // Local servers reject an empty header rather than ignoring it, so a
        // placeholder is kinder than nothing.
        apiKey: key ?? 'not-needed',
      })(posting.model)
  }
}

const resolveKey = (spec: ProviderSpec, credentials: Credentials): string | null =>
  credentials.credentialFor(spec.name) ?? (spec.envVar ? (process.env[spec.envVar] ?? null) : null)

const knownNames = () => ['anthropic', 'openai', 'google', 'openrouter', 'xai', 'groq', 'deepseek', 'ollama'].join(', ')

/**
 * Is this provider actually reachable? Used by `roofscape doctor`, so that a
 * misconfiguration is found while someone is looking at the screen rather than
 * at three in the morning in the middle of a task.
 */
export async function probeProvider(
  name: string,
  credentials: Credentials,
): Promise<{ ok: true; models?: number } | { ok: false; reason: string; remedy: string }> {
  const spec = providerSpec(name)
  if (!spec) return { ok: false, reason: `Unknown provider "${name}".`, remedy: `Known: ${knownNames()}.` }

  const key = resolveKey(spec, credentials)
  if (spec.needsKey && !key) {
    return {
      ok: false,
      reason: `No credential for ${spec.label}.`,
      remedy: spec.envVar ? `Set ${spec.envVar}, or run: roofscape provider add ${name}` : `Run: roofscape provider add ${name}`,
    }
  }

  if (!spec.baseUrl) return { ok: true }

  try {
    const response = await fetch(`${spec.baseUrl}/models`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      return {
        ok: false,
        reason: `${spec.label} answered ${response.status}.`,
        remedy: response.status === 401 ? 'The credential looks wrong or expired.' : 'Check the service is up.',
      }
    }
    const body = (await response.json()) as { data?: unknown[] }
    return Array.isArray(body.data) ? { ok: true, models: body.data.length } : { ok: true }
  } catch (error) {
    const local = !spec.needsKey
    return {
      ok: false,
      reason: `Could not reach ${spec.label}: ${(error as Error).message}`,
      remedy: local ? `Is it running? Try: ${name} serve` : 'Check the network and the base URL.',
    }
  }
}
