import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { dataRoot, ensureDir } from '@app/core'

/**
 * The daemon can start agents, which run shell commands and write files. That
 * makes an unauthenticated port on this machine a remote shell, so there isn't
 * one: every request carries a token, generated on first run and readable only
 * by the owner.
 */
export function daemonToken(): string {
  const path = join(ensureDir(dataRoot()), 'daemon.token')
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()

  const token = randomBytes(32).toString('base64url')
  writeFileSync(path, token, { mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}

/** Constant-time, so the comparison itself does not leak the token. */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]
}
