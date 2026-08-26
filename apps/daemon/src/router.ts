import type { IncomingMessage, ServerResponse } from 'node:http'

export interface Ctx {
  request: IncomingMessage
  response: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  body: <T>() => Promise<T>
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown

interface Route {
  method: string
  segments: string[]
  handler: Handler
}

/**
 * A router small enough to read.
 *
 * A framework would be a dependency, an upgrade treadmill, and a second set of
 * conventions, for a service with a dozen routes. Paths are matched segment by
 * segment; `:name` captures.
 */
export class Router {
  private readonly routes: Route[] = []

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler })
    return this
  }

  get = (path: string, handler: Handler) => this.add('GET', path, handler)
  post = (path: string, handler: Handler) => this.add('POST', path, handler)

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean)
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue
      const params: Record<string, string> = {}
      let matched = true
      for (const [index, segment] of route.segments.entries()) {
        const actual = parts[index]!
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(actual)
        else if (segment !== actual) { matched = false; break }
      }
      if (matched) return { handler: route.handler, params }
    }
    return null
  }
}

/** Errors that are the caller's fault, and say so with the right status. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export const notFound = (what: string) => new HttpError(404, `No such ${what}.`)
export const badRequest = (why: string) => new HttpError(400, why)

/** Bodies are capped: a daemon on localhost is still a service. */
export async function readJson<T>(request: IncomingMessage, limit = 256 * 1024): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > limit) throw badRequest('That request body is too large.')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw badRequest('That request body is not valid JSON.')
  }
}
