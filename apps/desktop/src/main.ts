import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
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

/**
 * Name the app before anything asks it what it is called.
 *
 * Unpackaged, Electron takes the name from package.json, which is
 * `@app/desktop` — and `getPath('userData')` then contains a slash, so the
 * single-instance lock cannot be taken and `requestSingleInstanceLock()` returns
 * false. The app quit before it ever opened a window, silently and with exit
 * code 0, which is why `npm run desktop` did nothing at all.
 *
 * electron-builder sets `productName` for a packaged build, so only running
 * from a checkout was affected — which is to say, only ever the person
 * developing it. Setting it here fixes that and makes the two agree: unpackaged
 * and installed now keep their state in the same place.
 */
app.setName(BRAND.name)

/**
 * An installation is a data directory, and that has to include this window.
 *
 * `ROOFSCAPE_HOME` is documented as the way to run a second copy without
 * disturbing the first — it is how the tests get their own, and how you look at
 * a first run without losing what you have. For the daemon it always was. For
 * the app it never was: Electron keys `userData` off the app's *name*, and the
 * single-instance lock is keyed off `userData`, so both copies wanted the same
 * one however many data directories you gave them.
 *
 * So the second one lost the lock and quit, and the honest advice — "give it
 * somewhere of its own" — did not work when followed. Electron's own state
 * lives under the data directory now, which makes the lock per-installation and
 * makes one variable mean one whole thing.
 */
const HOME = process.env.ROOFSCAPE_HOME
if (HOME) app.setPath('userData', join(resolve(HOME), 'electron'))

/**
 * Two windows would be two daemons racing for one lock, and the loser exits.
 *
 * It used to exit in silence. That is right for the case it was written for —
 * somebody double-clicking the icon twice, where the copy already running takes
 * its window to the front and there is nothing to explain. It is wrong for the
 * other case, and the other case is the one whoever is working on this hits:
 * with the installed app open, `npm run desktop` built the whole bundle,
 * printed "Done", exited 0, and opened nothing. Every symptom of a build that
 * worked, and no window to show for it.
 */
if (!app.requestSingleInstanceLock()) {
  process.stdout.write(
    `\n${BRAND.name} is already running here, and has brought its window to the front.\n` +
      `That copy holds ${HOME ?? join(homedir(), BRAND.homeDir)}, so this one stopped rather\n` +
      `than open a second window onto the same buildings.\n\n` +
      `To run this build beside it, give it an installation of its own — a data\n` +
      `directory, and a port, since a fresh directory walks past the lock and\n` +
      `collides on the port instead:\n\n` +
      `  ROOFSCAPE_HOME=~/${BRAND.homeDir}-dev ROOFSCAPE_PORT=7788 npm run desktop\n\n`,
  )
  // Not `quit()`: that is a request, and the rest of this file goes on running
  // while it is being considered.
  app.exit(0)
}

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
    // Matching the dashboard's own ground is what stops a flash before the first
    // paint. It is one colour rather than two now: the city is drawn at dusk and
    // the page around it is dark whatever the system theme says, because a
    // skyline at noon on white is a different product.
    backgroundColor: '#100f17',
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

// Where an update cannot install itself — macOS, until these builds carry a
// real certificate — the offer is the download rather than a restart.
ipcMain.on('update:download', () => {
  const url = updates?.downloadUrl()
  if (url) void shell.openExternal(url)
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
