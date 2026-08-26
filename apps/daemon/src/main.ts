#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BRAND, dataRoot } from '@app/core'
import { buildApi } from './api.js'
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

const events = new EventStream()
const api = buildApi(events)
const token = daemonToken()

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
  // fetchable before it can present one. It ships no data of its own.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    await sendDashboard(response)
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

async function sendDashboard(response: ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(HERE, '..', 'public', 'index.html'))
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length })
    response.end(html)
  } catch {
    send(response, 500, { error: 'The dashboard page is missing from this install.' })
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
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    process.stdout.write('\n  Bound beyond this machine. Anyone who reaches this port and holds the\n')
    process.stdout.write('  token can run shell commands here. Put it behind something.\n')
  }
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    process.stdout.write('\nShutting down.\n')
    events.closeAll()
    server.close(() => process.exit(0))
    // A goal in flight can hold the process open; do not wait forever for it.
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
