/**
 * Keep secrets out of the archives.
 *
 * The archives are the durable copy. A key that reaches a note is there for
 * good, is returned by every future recall that matches it, and will be
 * consolidated by the curator into something even more permanent. And the
 * owner can legitimately approve an agent reading a `.env` — so the secret does
 * sometimes reach the agent, and this is where it has to stop.
 *
 * Applied at the one door into memory rather than at each caller, so that a
 * future way of writing a note cannot forget to do it.
 *
 * This is a net, not a wall. It catches the shapes that credentials actually
 * have; it cannot catch a password that looks like an English word. It is worth
 * having anyway: nearly every real leak is a key with a recognisable prefix.
 */

interface Shape {
  what: string
  pattern: RegExp
}

const SHAPES: readonly Shape[] = [
  { what: 'an Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { what: 'an OpenAI key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { what: 'a GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { what: 'a GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { what: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { what: 'a Google key', pattern: /\bAIza[A-Za-z0-9_-]{30,}/g },
  { what: 'a Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { what: 'a Stripe key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { what: 'a private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { what: 'a bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/g },
  // A connection string with a password in it, which is how database
  // credentials usually travel.
  { what: 'a password in a URL', pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@]{3,})@/gi },
  // The last resort: a name that says secret, an equals, and something long
  // enough to be one. Deliberately last, because it is the loosest.
  {
    what: 'a credential',
    pattern: /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)S?)\s*[=:]\s*["']?([A-Za-z0-9_\-./+]{12,})["']?/gi,
  },
]

export interface Redaction {
  text: string
  /** What was taken out, for telling the owner it happened. */
  removed: string[]
}

export function redactSecrets(input: string): Redaction {
  let text = input
  const removed: string[] = []

  for (const shape of SHAPES) {
    text = text.replace(shape.pattern, (match, ...groups: unknown[]) => {
      // For the two shapes with a keeper group, keep the harmless half so the
      // note still says which variable or which host it was about.
      const keeper = typeof groups[0] === 'string' ? (groups[0] as string) : null
      removed.push(shape.what)
      if (shape.what === 'a password in a URL' && keeper) return `${keeper}:[redacted]@`
      if (shape.what === 'a credential' && keeper) return `${keeper}=[redacted]`
      return `[redacted: ${shape.what}]`
    })
  }

  return { text, removed }
}

export const containsSecret = (input: string): boolean => redactSecrets(input).removed.length > 0
