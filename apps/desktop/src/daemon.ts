import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// Reached through their own modules rather than the package entry on purpose:
// the entry re-exports the whole of core, which would pull the provider SDKs
// into a process that wants a product name and a directory. Core declares no
// exports map, so these paths are part of what it offers.
import { BRAND } from '@app/core/dist/brand.js'
import { dataRoot } from '@app/core/dist/store/paths.js'

/**
 * The daemon, seen from the app that shows it.
 *
 * The app does not insist on owning one. Somebody who already ran `roofscaped`
 * in a terminal has a daemon with their work in it, and the single-instance lock
 * means a second would refuse to start anyway — so the app looks first, and only
 * starts one when nothing answers. What it did not start, it does not stop.
 */

const HOST = process.env.ROOFSCAPE_HOST ?? '127.0.0.1'
const PORT = Number(process.env.ROOFSCAPE_PORT ?? 7717)

export interface Daemon {
  readonly origin: string
  readonly token: string
  /** Whether this app started it, and so is the thing that must stop it. */
  readonly owned: boolean
}

export class DaemonUnreachable extends Error {}

const origin = (): string => `http://${HOST}:${PORT}`

/** Written by the daemon on first run, readable only by the owner. */
const tokenPath = (): string => join(dataRoot(), 'daemon.token')

const readToken = (): string | null => {
  const path = tokenPath()
  if (!existsSync(path)) return null
  const token = readFileSync(path, 'utf8').trim()
  return token.length > 0 ? token : null
}

/**
 * A daemon is alive if it answers /api/health with our token. Anything else on
 * the port is not ours: a 401 means somebody else's service is sitting there,
 * and starting a second one would only lose to the lock.
 */
async function answers(token: string | null): Promise<boolean> {
  if (!token) return false
  try {
    const response = await fetch(`${origin()}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  } catch {
    return false
  }
}

let child: ChildProcess | null = null

/**
 * Forked from this app's own binary. Electron's bundled Node *is* Node 24, so
 * ELECTRON_RUN_AS_NODE runs the daemon on the runtime this repo already targets
 * without anything being installed on the machine. See decision 0012.
 */
function fork(entry: string, log: (line: string) => void): ChildProcess {
  const spawned = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  spawned.stdout?.on('data', (chunk: Buffer) => log(chunk.toString().trimEnd()))
  spawned.stderr?.on('data', (chunk: Buffer) => log(chunk.toString().trimEnd()))
  return spawned
}

export async function startDaemon(entry: string, log: (line: string) => void): Promise<Daemon> {
  const existing = readToken()
  if (await answers(existing)) {
    log(`Adopted the ${BRAND.name} service already running at ${origin()}.`)
    return { origin: origin(), token: existing!, owned: false }
  }

  log(`Starting the ${BRAND.name} service on ${origin()}.`)
  child = fork(entry, log)

  // The token does not exist until the daemon's first run has written it, so
  // both the file and the port are re-read on every attempt rather than once.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      // It refused to start. Most often that is the lock: something else got
      // there between our probe and our spawn, and that something is usable.
      const token = readToken()
      if (await answers(token)) return { origin: origin(), token: token!, owned: false }
      throw new DaemonUnreachable(`The ${BRAND.name} service stopped immediately (exit ${child.exitCode}).`)
    }
    const token = readToken()
    if (await answers(token)) return { origin: origin(), token: token!, owned: true }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new DaemonUnreachable(`The ${BRAND.name} service did not answer within 30 seconds.`)
}

/**
 * Only ever stops what this app started. SIGTERM first, because the daemon
 * handles it: it stops the ticker, releases the lock and closes the streams. A
 * goal in flight can hold it open, so there is a limit on how long we wait.
 */
export async function stopDaemon(owned: boolean): Promise<void> {
  const running = child
  child = null
  if (!running || !owned || running.exitCode !== null) return

  running.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const done = setTimeout(() => {
      running.kill('SIGKILL')
      resolve()
    }, 4000)
    running.once('exit', () => {
      clearTimeout(done)
      resolve()
    })
  })
}
