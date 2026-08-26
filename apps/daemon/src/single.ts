import { openSync, closeSync, writeSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataRoot, ensureDir } from '@app/core'

export interface Held {
  release: () => void
}

export class AlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(
      `Another Roofscape service is already running (process ${pid}).\n` +
        'Two of them would both fire the standing orders, and pay for the work twice.',
    )
    this.name = 'AlreadyRunningError'
  }
}

const lockPath = () => join(ensureDir(dataRoot()), 'daemon.pid')

/**
 * One service per data directory.
 *
 * Two would each run the ticker, so every standing order would fire twice and
 * be paid for twice — which is the kind of fault that shows up as a bill rather
 * than as an error.
 *
 * The file is created with `wx`, which fails if it already exists, so the check
 * and the claim are one operation and two services starting together cannot both
 * win it.
 */
export function claimSingleInstance(): Held {
  const path = lockPath()

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = openSync(path, 'wx')
      writeSync(handle, String(process.pid))
      closeSync(handle)
      return { release: () => remove(path) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      const holder = readPid(path)
      if (holder !== null && holder !== process.pid && alive(holder)) {
        throw new AlreadyRunningError(holder)
      }
      // Nobody is behind it: a previous service was killed without tidying up.
      // Clear it and take it, once.
      remove(path)
    }
  }

  throw new Error('Could not claim the service lock. Delete daemon.pid and try again.')
}

function readPid(path: string): number | null {
  try {
    const value = Number(readFileSync(path, 'utf8').trim())
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** Signal 0 asks whether a process exists without disturbing it. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists and belongs to somebody else, which still counts.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function remove(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Nothing useful to do; a stale file is cleared on the next start.
  }
}
