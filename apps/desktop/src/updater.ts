import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Updates, as the owner experiences them.
 *
 * Merging to main publishes a release; this finds it, downloads it quietly, and
 * then says so. Nothing is installed underneath somebody who is watching work
 * happen — a restart is the owner's to choose. If they never choose it, the
 * update goes on the next ordinary quit, so the slow path still converges.
 */

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  version?: string
  /** Whole percent, while downloading. */
  percent?: number
  message?: string
}

/** How often to look. On launch, then rarely enough not to be noise. */
const EVERY = 30 * 60 * 1000

export interface Updates {
  check(): void
  /** Stop the daemon before this: it replaces the app and does not come back here. */
  installNow(): void
}

export function wireUpdates(publish: (state: UpdateState) => void): Updates {
  // A build running from source has no release to compare itself against, and
  // asking would only throw. The button never appears in development.
  if (!app.isPackaged) {
    return { check: () => publish({ phase: 'idle', message: 'Updates are only checked in a packaged build.' }), installNow: () => {} }
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => publish({ phase: 'available', version: info.version }))
  autoUpdater.on('download-progress', (progress) =>
    publish({ phase: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => publish({ phase: 'ready', version: info.version }))
  autoUpdater.on('update-not-available', () => publish({ phase: 'idle' }))
  autoUpdater.on('error', (error: Error) =>
    publish({ phase: 'error', message: error.message }))

  const check = (): void => {
    // An offline machine, or a rate-limited feed, is not an event worth
    // interrupting anybody about. The next check is half an hour away.
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      publish({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }

  check()
  setInterval(check, EVERY).unref()

  return { check, installNow: () => autoUpdater.quitAndInstall() }
}
