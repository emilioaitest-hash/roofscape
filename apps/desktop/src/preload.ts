import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateState } from './updater.js'

/**
 * The only thing the page gets that a browser tab would not.
 *
 * The dashboard is the same page either way — served by the daemon, opened in a
 * browser or shown in this window — so it cannot assume any of this exists. It
 * checks for `window.roofscape` and stays exactly as it was when there is none.
 */

const argument = (flag: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`${flag}=`))?.slice(flag.length + 1)

contextBridge.exposeInMainWorld('roofscape', {
  /** The tell. A browser has no such object. */
  desktop: true,
  version: argument('--roofscape-version') ?? '0.0.0',
  platform: process.platform,

  onUpdate(handler: (state: UpdateState) => void): void {
    ipcRenderer.on('update:state', (_event, state: UpdateState) => handler(state))
  },
  checkForUpdate(): void {
    ipcRenderer.send('update:check')
  },
  restartToUpdate(): void {
    ipcRenderer.send('update:install')
  },
})
