import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
// Reached through its own module rather than the package entry: the entry
// re-exports the whole of core, which would pull the provider SDKs into a
// process that wants a domain name.
import { BRAND } from '@app/core/dist/brand.js'

/**
 * Updates, as the owner experiences them.
 *
 * Merging to main publishes a release; this finds it, downloads it quietly, and
 * then says so. Nothing is installed underneath somebody who is watching work
 * happen — a restart is the owner's to choose. If they never choose it, the
 * update goes on the next ordinary quit, so the slow path still converges.
 *
 * On macOS none of that happens, and the reason is not a bug that can be fixed
 * here. Squirrel.Mac verifies the downloaded bundle's signature against the
 * running app's designated requirement before it will install anything, and
 * these builds are ad-hoc signed — an ad-hoc signature has no stable identity,
 * so the check cannot pass. Nothing short of a Developer ID certificate changes
 * that. See CLAUDE.md, and the ad-hoc signing hook, which solves a different
 * problem: it is what stops macOS calling the app *damaged*.
 *
 * So on macOS this says a version is out and offers the download, rather than
 * fetching 130MB it can never use and offering a restart that would fail.
 */

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'ready' | 'manual' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  version?: string
  /** Whole percent, while downloading. */
  percent?: number
  message?: string
  /** Where to get it by hand, when that is the only way. */
  url?: string
}

/** How often to look. On launch, then rarely enough not to be noise. */
const EVERY = 30 * 60 * 1000

/**
 * True where an update can actually be installed.
 *
 * Windows and Linux update normally. macOS cannot until these builds carry a
 * real certificate — and the day they do, this becomes `true` there too and the
 * ordinary path takes over without anything else changing.
 */
const canInstallItself = process.platform !== 'darwin' || Boolean(process.env.CSC_LINK || process.env.CSC_NAME)

/** The product's own download page, which picks the right file per platform. */
function downloadPage(): string {
  const platform =
    process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : process.platform === 'win32' ? 'win'
    : 'linux'
  return `https://${BRAND.domain}/api/download?platform=${platform}`
}

export interface Updates {
  check(): void
  /** Stop the daemon before this: it replaces the app and does not come back here. */
  installNow(): void
  /** Where to get it by hand. */
  downloadUrl(): string
}

export function wireUpdates(publish: (state: UpdateState) => void): Updates {
  // A build running from source has no release to compare itself against, and
  // asking would only throw. The button never appears in development.
  if (!app.isPackaged) {
    return {
      check: () => publish({ phase: 'idle', message: 'Updates are only checked in a packaged build.' }),
      installNow: () => {},
      downloadUrl: downloadPage,
    }
  }

  // Downloading an update that cannot be installed is 130MB of somebody's
  // bandwidth spent on nothing, and `autoInstallOnAppQuit` would then retry the
  // failing install on every single quit.
  autoUpdater.autoDownload = canInstallItself
  autoUpdater.autoInstallOnAppQuit = canInstallItself

  autoUpdater.on('update-available', (info) =>
    publish(
      canInstallItself
        ? { phase: 'available', version: info.version }
        : { phase: 'manual', version: info.version, url: downloadPage() },
    ))
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

  return { check, installNow: () => autoUpdater.quitAndInstall(), downloadUrl: downloadPage }
}
