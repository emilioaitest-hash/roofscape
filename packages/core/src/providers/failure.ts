/**
 * What kind of failure this is, and whether anything can be done about it.
 *
 * The distinction that matters is between "ask something else" and "stop": a
 * wrong key will never come right by being retried, and a usage limit will
 * never come right by being retried *at this provider*.
 */
export type FailureKind =
  | 'limit'       // rate limited, or a plan's allowance is used up
  | 'unavailable' // the provider is down or unreachable
  | 'credential'  // wrong, missing or expired key
  | 'request'     // the request itself is wrong: bad model id, too long
  | 'unknown'

export interface Failure {
  kind: FailureKind
  /** Worth trying somewhere else with the same task? */
  worthFallingBackTo: boolean
  message: string
  /** What the owner should do, when there is something. */
  remedy: string | null
}

export function classifyFailure(error: unknown): Failure {
  const message = error instanceof Error ? error.message : String(error)
  const status = statusOf(error)
  const lower = message.toLowerCase()

  if (status === 429 || /rate.?limit|too many requests|quota|usage limit|overloaded/.test(lower)) {
    return {
      kind: 'limit',
      worthFallingBackTo: true,
      message,
      remedy: 'This provider is rate limited or out of allowance. Another one can pick the work up.',
    }
  }

  if (status === 401 || status === 403 || /unauthor|forbidden|invalid api key|not logged in/.test(lower)) {
    return {
      kind: 'credential',
      worthFallingBackTo: true,
      message,
      // Falling back is still right: the work should not stop because one
      // provider's key went stale, but the owner has to know it did.
      remedy: 'That provider will not accept the credential. Check it with: roofscape doctor',
    }
  }

  if ((status !== null && status >= 500) || /timeout|timed out|econnrefused|enotfound|socket|network|fetch failed/.test(lower)) {
    return {
      kind: 'unavailable',
      worthFallingBackTo: true,
      message,
      remedy: 'The provider did not answer. It may be a passing outage.',
    }
  }

  if (status === 400 || status === 404 || status === 422 || /model.*not found|unknown model|context length|too long/.test(lower)) {
    return {
      kind: 'request',
      worthFallingBackTo: false,
      message,
      remedy: /context length|too long/.test(lower)
        ? 'The task grew past what this model can hold. Split it into smaller ones.'
        : 'The request was refused as malformed — usually a model id this provider does not have.',
    }
  }

  return { kind: 'unknown', worthFallingBackTo: true, message, remedy: null }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  for (const key of ['statusCode', 'status', 'code']) {
    const value = (error as Record<string, unknown>)[key]
    if (typeof value === 'number' && value >= 100 && value < 600) return value
  }
  const cause = (error as { cause?: unknown }).cause
  return cause !== undefined && cause !== error ? statusOf(cause) : null
}
