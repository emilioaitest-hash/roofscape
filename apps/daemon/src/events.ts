import type { ServerResponse } from 'node:http'

export interface DaemonEvent {
  kind: string
  building?: string
  floor?: string
  detail?: string
  at: string
  /** Anything structured the event carries. Deliberately not an index
   * signature: that would let `kind` be dropped without a complaint. */
  data?: Record<string, unknown>
}

/**
 * Server-sent events, so a dashboard can watch a goal being worked rather than
 * polling for it. One-way and plain HTTP: a websocket would buy nothing here,
 * because nothing the client sends needs to arrive this way.
 */
export class EventStream {
  private readonly listeners = new Set<ServerResponse>()
  /** Kept so a page that opens mid-goal is not looking at an empty screen. */
  private readonly recent: DaemonEvent[] = []

  subscribe(response: ServerResponse): () => void {
    // Every write goes through a guard, the opening one included. A client can
    // vanish between making the request and this line, and an unguarded write
    // then throws inside whatever called subscribe — which in the server is the
    // request handler for everybody else.
    const ok = this.attempt(response, () => {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      response.write(': connected\n\n')
    })
    if (!ok) return () => {}

    for (const event of this.recent) this.send(response, event)

    this.listeners.add(response)
    // Unref'd: a keep-alive should not be a reason for the process to stay
    // alive. Without this a single subscriber holds the event loop open, which
    // hangs anything that opened a stream and expected to exit.
    const heartbeat = setInterval(() => {
      try {
        response.write(': keep-alive\n\n')
      } catch {
        this.listeners.delete(response)
      }
    }, 25_000)
    heartbeat.unref()

    return () => {
      clearInterval(heartbeat)
      this.listeners.delete(response)
    }
  }

  emit(event: Omit<DaemonEvent, 'at'>): void {
    const full: DaemonEvent = { ...event, at: new Date().toISOString() }
    this.recent.push(full)
    if (this.recent.length > 100) this.recent.shift()
    for (const listener of this.listeners) this.send(listener, full)
  }

  private send(response: ServerResponse, event: DaemonEvent): void {
    this.attempt(response, () => response.write(`data: ${JSON.stringify(event)}\n\n`))
  }

  /** Do it, and drop the listener rather than throw if the socket has gone. */
  private attempt(response: ServerResponse, write: () => void): boolean {
    try {
      write()
      return true
    } catch {
      this.listeners.delete(response)
      return false
    }
  }

  get watching(): number {
    return this.listeners.size
  }

  closeAll(): void {
    for (const listener of this.listeners) {
      try { listener.end() } catch { /* already gone */ }
    }
    this.listeners.clear()
  }
}
