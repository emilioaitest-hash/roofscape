import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join, sep } from 'node:path'
// Reached through their own modules rather than the package entry on purpose:
// the entry re-exports the whole of core, which would pull the provider SDKs
// into a process that wants a product name and a directory. Core declares no
// exports map, so these paths are part of what it offers.
import { BRAND } from '@app/core/dist/brand.js'
import { startDaemon, stopDaemon, type Daemon } from './daemon.js'
import { wireUpdates, type UpdateState, type Updates } from './updater.js'

/**
 * The desktop app: one window onto the daemon, and the thing that keeps the
 * daemon alive for it.
 *
 * There is deliberately no interface of its own. The dashboard the daemon serves
 * is the interface, in a browser and in here alike, so the two cannot drift
 * apart — the same reason the skyline art comes from one renderer.
 */

/** Files that must exist on disk rather than inside the archive. */
const unpacked = (path: string): string => path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)

/** The daemon, bundled beside this file, run on the Node that Electron carries. */
const daemonEntry = (): string => unpacked(join(__dirname, 'daemon.mjs'))

// Two windows would be two daemons racing for one lock, and the loser exits.
if (!app.requestSingleInstanceLock()) app.quit()

let window: BrowserWindow | null = null
let daemon: Daemon | null = null
let updates: Updates | null = null
let latest: UpdateState = { phase: 'idle' }

const log = (line: string): void => {
  if (line.length > 0) process.stdout.write(`[${BRAND.slug}] ${line}\n`)
}

/**
 * State is kept as well as sent. The page can load after an update was already
 * found — on a restart, or when the daemon was slow — and a button that only
 * ever fires on the event would silently never appear.
 */
function publish(state: UpdateState): void {
  latest = state
  window?.webContents.send('update:state', state)
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 860,
    minHeight: 560,
    show: false,
    // The dashboard paints its own background from the system theme; matching it
    // here is what stops a white flash before the first paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14130f' : '#faf9f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: BRAND.name,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--roofscape-version=${app.getVersion()}`],
    },
  })

  // A link to somewhere else is somewhere else's business. Nothing outside the
  // daemon gets to open inside a window that holds the daemon's token.
  created.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  created.webContents.on('will-navigate', (event, url) => {
    if (daemon && !url.startsWith(daemon.origin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  created.once('ready-to-show', () => created.show())
  created.on('closed', () => {
    window = null
  })
  return created
}

async function boot(): Promise<void> {
  window = createWindow()

  try {
    daemon = await startDaemon(daemonEntry(), log)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(`${BRAND.name} could not start`, message)
    app.quit()
    return
  }

  // The page reads the token from the query, moves it into session storage and
  // strips it from the address. That is the daemon's own flow, already tested;
  // this window uses it rather than inventing a second way in.
  await window.loadURL(`${daemon.origin}/?token=${encodeURIComponent(daemon.token)}`)

  // Re-announce once the page can hear it, so a restart into an already-found
  // update still shows the button.
  window.webContents.on('did-finish-load', () => window?.webContents.send('update:state', latest))

  updates = wireUpdates(publish)
}

app.whenReady().then(boot).catch((error: unknown) => {
  dialog.showErrorBox(`${BRAND.name} could not start`, String(error))
  app.quit()
})

app.on('second-instance', () => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void boot()
})

ipcMain.on('update:check', () => updates?.check())

ipcMain.on('update:install', () => {
  // The installer replaces this app and does not come back through the quit
  // handler, so the daemon is stopped here or not at all.
  void stopDaemon(daemon?.owned ?? false).then(() => updates?.installNow())
})

// Closing the last window ends the app on every platform, macOS included. The
// daemon is the thing that runs without a window, and it is reachable without
// this app; an invisible copy of the app on top of it helps nobody.
app.on('window-all-closed', () => app.quit())

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !daemon?.owned) return
  // Stopping is asynchronous and the quit would not wait for it, so the first
  // quit is deferred and re-issued once the daemon is actually down.
  event.preventDefault()
  quitting = true
  void stopDaemon(true).then(() => app.quit())
})
