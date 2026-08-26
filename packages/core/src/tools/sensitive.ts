import { basename } from 'node:path'

/**
 * Files that are usually secrets, and are read differently.
 *
 * Closing the environment stopped an agent reading the owner's keys from
 * `process.env`. A repository's own `.env` is still sitting inside the workspace
 * where the agent is allowed to read, and a key that reaches a tool result is
 * then in the transcript, in the archives, and in any file the agent writes.
 *
 * These are not refused — an agent debugging a configuration problem has a real
 * reason to look, and refusing outright would make it lie to itself about what
 * it checked. They are put to the owner, like an unfamiliar shell command.
 */
const BY_NAME = new Set([
  '.env', '.env.local', '.env.production', '.env.development', '.env.test',
  '.npmrc', '.pypirc', '.netrc', '_netrc', '.htpasswd',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  'credentials', 'credentials.json', 'service-account.json',
  'secrets.json', 'secrets.yaml', 'secrets.yml',
  '.git-credentials', '.dockercfg',
])

const BY_SHAPE: readonly RegExp[] = [
  /^\.env($|\.)/i,          // .env.anything
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
  /\.keystore$/i,
  /(^|[.-])secret(s)?($|[.-])/i,
  /(^|[.-])credential(s)?($|[.-])/i,
]

/** Public keys are not secrets, and refusing them is just noise. */
const NEVER = [/\.pub$/i, /\.key\.example$/i, /^\.env\.(example|sample|template)$/i]

export function isProbablySecret(path: string): boolean {
  const name = basename(path)
  if (NEVER.some((pattern) => pattern.test(name))) return false
  if (BY_NAME.has(name)) return true
  return BY_SHAPE.some((pattern) => pattern.test(name))
}

/** What the owner is asked, phrased so the answer is obvious. */
export const whyItIsBeingAsked = (path: string): string =>
  `Read ${path}. It looks like it holds secrets, and anything read goes into this building's archives.`
