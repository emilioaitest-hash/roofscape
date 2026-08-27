#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BRAND, dataRoot, SkylineStore, BuildingStore } from '@app/core'
import { buildApi, startGoal, isWorking } from './api.js'
import { Mailbridge } from './bridge.js'
import { startTicker } from './ticker.js'
import { recoverInterruptedWork } from './recover.js'
import { claimSingleInstance, AlreadyRunningError } from './single.js'
import { EventStream } from './events.js'
import { HttpError, readJson } from './router.js'
import { daemonToken, tokenMatches, bearerFrom } from './auth.js'

/**
 * The headless service. Everything that does work lives here; the CLI, the
 * dashboard and eventually a phone are all just windows onto it.
 *
 * It binds to loopback by default and will not bind anywhere else without being
 * told twice, because a daemon that starts agents is a daemon that can run shell
 * commands, and one on 0.0.0.0 is a remote shell with a nice API.
 */
const PORT = Number(process.env.ROOFSCAPE_PORT ?? 7717)
const HOST = process.env.ROOFSCAPE_HOST ?? '127.0.0.1'

// One service per data directory: two would each run the ticker, so every
// standing order would fire twice and be paid for twice.
let lock
try {
  lock = claimSingleInstance()
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    process.stderr.write(`\n${error.message}\n\n`)
    process.exit(1)
  }
  throw error
}

const events = new EventStream()

/**
 * Discord, if it has been set up. Constructed either way so that switching it on
 * from the dashboard does not need a restart.
 */
const bridge = new Mailbridge({
  events,
  startGoal: (buildingId, goal, source) => {
    const sky = SkylineStore.open()
    try {
      const building = sky.get(buildingId)
      if (!building) return 'There is no such building any more.'
      if (isWorking(building.id)) return `${building.name} is already working on something.`
      const store = BuildingStore.open(building.id)
      const staffed = store.headcount() > 0
      const heldBy = store.claimHolder()
      store.close()
      if (!staffed) return `${building.name} has nobody in it yet.`
      if (heldBy !== null) return `${building.name} is already being worked on.`
      startGoal(events, building, goal, { source })
      return `Started. ${building.name} is on it.`
    } finally {
      sky.close()
    }
  },
})

const api = buildApi(events, bridge)
const token = daemonToken()
// Before anything else: a task left mid-flight by a crash or a closed lid is
// marked working with nothing left to finish it.
const recovered = recoverInterruptedWork(events)
const stopTicker = startTicker(events)

const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    send(response, 500, { error: (error as Error).message })
  })
})

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  // A browser page served from somewhere else may not read this. The token is
  // the real gate; this stops a stray page from even trying.
  response.setHeader('access-control-allow-origin', originAllowed(request.headers.origin) ? request.headers.origin! : 'null')
  response.setHeader('access-control-allow-headers', 'authorization, content-type')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  // The page itself is not the secret; the token is, and the page has to be
  // fetchable before it can present one. It ships no data of its own, and
  // neither do its stylesheet and script — a browser cannot put an
  // authorization header on a <link> or a <script src>, so gating them would
  // mean inlining the whole dashboard into one file to avoid the problem.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    await sendAsset(response, 'index.html')
    return
  }
  if (ASSETS.has(url.pathname)) {
    await sendAsset(response, url.pathname.slice(1))
    return
  }

  if (!tokenMatches(bearerFrom(request.headers.authorization) ?? url.searchParams.get('token') ?? undefined, token)) {
    send(response, 401, { error: 'Unauthorized.', remedy: `The token is in ${dataRoot()}/daemon.token` })
    return
  }

  if (url.pathname === '/api/events') {
    const unsubscribe = events.subscribe(response)
    request.on('close', unsubscribe)
    return
  }

  const route = api.match(request.method ?? 'GET', url.pathname)
  if (!route) {
    send(response, 404, { error: `No route for ${request.method} ${url.pathname}` })
    return
  }

  try {
    const result = await route.handler({
      request,
      response,
      params: route.params,
      query: url.searchParams,
      body: <T>() => readJson<T>(request),
    })
    send(response, 200, result ?? { ok: true })
  } catch (error) {
    if (error instanceof HttpError) send(response, error.status, { error: error.message })
    else send(response, 500, { error: (error as Error).message })
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Everything the dashboard is allowed to fetch off disk, named one by one.
 *
 * A list rather than a directory walk: this is the one part of the service that
 * answers before the token is checked, and a path that reaches the filesystem
 * without an allowlist is the shape of bug that ends up reading `daemon.token`.
 */
const ASSETS = new Map<string, string>([
  ['/app.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
])

const TYPES: Record<string, string> = { 'index.html': 'text/html; charset=utf-8' }

async function sendAsset(response: ServerResponse, name: string): Promise<void> {
  const type = TYPES[name] ?? ASSETS.get(`/${name}`) ?? 'application/octet-stream'
  try {
    const body = await readFile(join(HERE, '..', 'public', name))
    response.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      // The page and its assets are rebuilt with the daemon, and a stale one
      // against a new API is a bug report that reads like a haunting.
      'cache-control': 'no-store',
    })
    response.end(body)
  } catch {
    send(response, 500, { error: `The dashboard is missing ${name} from this install.` })
  }
}

/** Only pages served from this machine, and only when a browser says so. */
const originAllowed = (origin: string | undefined): boolean =>
  origin !== undefined && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return
  const text = JSON.stringify(body, null, 2)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

server.listen(PORT, HOST, () => {
  const where = `http://${HOST}:${PORT}`
  process.stdout.write(`${BRAND.name} is running at ${where}\n`)
  process.stdout.write(`  data:  ${dataRoot()}\n`)
  process.stdout.write(`  token: ${dataRoot()}/daemon.token\n`)
  process.stdout.write(`\n  Open:  ${where}/?token=${token}\n`)
  process.stdout.write('\n  Standing orders are checked every 30 seconds.\n')
  bridge.reload()
  if (bridge.status.state !== 'off') process.stdout.write('  Discord bridge: connecting.\n')
  if (recovered > 0) {
    process.stdout.write(`  ${recovered} interrupted task${recovered === 1 ? '' : 's'} put back in the queue.\n`)
  }
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    process.stdout.write('\n  Bound beyond this machine. Anyone who reaches this port and holds the\n')
    process.stdout.write('  token can run shell commands here. Put it behind something.\n')
  }
})

// A crash still leaves the file behind; the next start finds nothing alive
// behind it and clears it. This is for the ordinary exit.
process.on('exit', () => lock.release())

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    process.stdout.write('\nShutting down.\n')
    stopTicker()
    bridge.stop()
    lock.release()
    events.closeAll()
    server.close(() => process.exit(0))
    // A goal in flight can hold the process open; do not wait forever for it.
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
