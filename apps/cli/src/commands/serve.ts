import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { dataRoot } from '@app/core'
import { say, dim, bold, fail, note } from '../ui.js'

/**
 * Start the service and open it.
 *
 * One command, because "run the daemon, find the token, build a URL, open a
 * browser" is four things to get right before anything happens, and the first
 * five minutes are the ones people give up in.
 */
export async function serve(options: { open?: boolean; port?: string; host?: string }): Promise<void> {
  const daemon = findDaemon()
  if (!daemon) {
    fail(
      'The service is not built.',
      'Run:  npm run build',
    )
  }

  const port = options.port ?? process.env.ROOFSCAPE_PORT ?? '7717'
  const host = options.host ?? process.env.ROOFSCAPE_HOST ?? '127.0.0.1'

  const child = spawn(process.execPath, [daemon], {
    env: { ...process.env, ROOFSCAPE_PORT: port, ROOFSCAPE_HOST: host },
    stdio: 'inherit',
  })

  // Opening happens after the daemon has had a moment to bind; opening a page
  // that is not there yet looks like a broken install.
  if (options.open !== false) {
    setTimeout(() => {
      const token = readToken()
      if (!token) return
      const url = `http://${host}:${port}/?token=${token}`
      say()
      say(`  ${bold('Opening')} ${dim(url)}`)
      openInBrowser(url)
    }, 900).unref()
  }

  child.on('exit', (code) => process.exit(code ?? 0))
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal))
  }
}

function findDaemon(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', '..', '..', 'daemon', 'dist', 'main.js'),
    join(here, '..', '..', '..', '..', 'apps', 'daemon', 'dist', 'main.js'),
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

function readToken(): string | null {
  const path = join(dataRoot(), 'daemon.token')
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
}

function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    note('Could not open a browser. The URL is above.')
  }
}
