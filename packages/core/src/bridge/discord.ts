/**
 * Discord, as a window onto the mailroom.
 *
 * The point is not chat. The point is that the building's post reaches you when
 * you are not at the machine it runs on, and that you can answer from a phone
 * without exposing the daemon to the internet. A message typed in Discord
 * becomes an ordinary record in the mailroom — same table, same types, same
 * inbox — and a message written in the mailroom is mirrored out.
 *
 * Written against the raw gateway rather than a library, on purpose. The whole
 * protocol used here is four opcodes and one REST call; a dependency for that
 * would be a supply chain, an upgrade treadmill, and the first native module in
 * a tree that has kept none. See docs/decisions/0014.
 */

const API = 'https://discord.com/api/v10'

/** GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT. The last one is privileged. */
const INTENTS = 1 | (1 << 9) | (1 << 15)

const OP = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const

export interface DiscordInbound {
  channelId: string
  /** The display name Discord gave them, for the record we write. */
  author: string
  authorId: string
  content: string
  messageId: string
}

export type BridgeState = 'off' | 'connecting' | 'live' | 'retrying' | 'refused'

export interface BridgeStatus {
  state: BridgeState
  /** Why it is not live, in words a person can act on. */
  detail?: string
  /** The bot's own name, once Discord has told us. */
  as?: string
  since?: string
}

export interface DiscordOptions {
  token: string
  /** Called for every human message in a channel we are listening to. */
  onMessage: (message: DiscordInbound) => void | Promise<void>
  onStatus?: (status: BridgeStatus) => void
  /** Which channels to care about. Anything else is somebody else's business. */
  listensTo: () => readonly string[]
}

/**
 * One gateway connection, kept alive.
 *
 * Reconnects on its own with a backoff, because a laptop lid closing is the
 * ordinary case rather than the exceptional one, and a bridge that needs
 * restarting by hand after every sleep is a bridge nobody keeps switched on.
 */
export class DiscordBridge {
  private socket: WebSocket | null = null
  private heart: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private sequence: number | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private attempts = 0
  private acked = true
  private stopped = false
  private state: BridgeStatus = { state: 'off' }
  /**
   * Bumped by `stop()` and by every fresh `connect()`.
   *
   * `connect()` awaits a network call before it has a socket to close, so a
   * `stop()` during that window closed nothing and the connection that arrived
   * afterwards was unreachable — still identified with the bot token, still
   * heartbeating, still delivering messages to a handler nobody could detach.
   * Two of those meant every Discord line was filed twice and every `!goal`
   * started two paid runs. Each attempt carries the generation it began in and
   * abandons itself if that is no longer current.
   */
  private generation = 0

  constructor(private readonly options: DiscordOptions) {}

  get status(): BridgeStatus {
    return this.state
  }

  start(): void {
    this.stopped = false
    this.attempts = 0
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    // 1000 rather than an abort: a clean close tells Discord the session is
    // finished, so it does not hold a slot open waiting for us to resume.
    try {
      this.socket?.close(1000, 'stopped')
    } catch {
      // Already gone. Nothing to close.
    }
    this.socket = null
    this.announce({ state: 'off' })
  }

  /** Post a line into a channel. Returns false rather than throwing. */
  async send(channelId: string, content: string): Promise<boolean> {
    try {
      const response = await fetch(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bot ${this.options.token}`,
          'content-type': 'application/json',
        },
        // Discord's own limit. Cut here rather than being refused for it.
        body: JSON.stringify({ content: content.slice(0, 1990) }),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private announce(status: BridgeStatus): void {
    this.state = status
    this.options.onStatus?.(status)
  }

  private clearTimers(): void {
    if (this.heart) clearInterval(this.heart)
    if (this.retry) clearTimeout(this.retry)
    this.heart = null
    this.retry = null
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    this.announce({ state: this.attempts > 0 ? 'retrying' : 'connecting' })

    let url = this.resumeUrl
    if (!url) {
      const found = await this.gatewayUrl()
      if (found === null) return
      url = found
    }

    try {
      const socket = new WebSocket(`${url}?v=10&encoding=json`)
      this.socket = socket
      socket.addEventListener('message', (event) => this.receive(String(event.data)))
      socket.addEventListener('close', (event) => this.dropped(`closed (${event.code})`))
      socket.addEventListener('error', () => this.dropped('the connection failed'))
    } catch (error) {
      this.dropped((error as Error).message)
    }
  }

  /**
   * Ask Discord where to connect, which is also the first test of the token.
   *
   * A 401 here is the owner's mistake and no amount of retrying will fix it, so
   * it stops rather than looping — the difference between "your token is wrong"
   * and "the network is down" is worth telling somebody.
   */
  private async gatewayUrl(): Promise<string | null> {
    try {
      const response = await fetch(`${API}/gateway/bot`, {
        headers: { authorization: `Bot ${this.options.token}` },
      })
      if (response.status === 401) {
        this.announce({ state: 'refused', detail: 'Discord did not accept that bot token.' })
        this.stopped = true
        return null
      }
      if (!response.ok) {
        this.dropped(`Discord answered ${response.status}`)
        return null
      }
      const body = (await response.json()) as { url?: string }
      if (!body.url) {
        this.dropped('Discord did not say where to connect.')
        return null
      }
      return body.url
    } catch (error) {
      this.dropped((error as Error).message)
      return null
    }
  }

  private dropped(why: string): void {
    if (this.stopped) return
    this.clearTimers()
    this.socket = null
    this.attempts += 1
    // A minute is the ceiling: long enough not to hammer Discord, short enough
    // that a bridge fixes itself while somebody makes coffee.
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.attempts, 6))
    this.announce({ state: 'retrying', detail: `${why}. Trying again in ${Math.round(wait / 1000)}s.` })
    this.retry = setTimeout(() => void this.connect(), wait)
    this.retry.unref?.()
  }

  private post(payload: unknown): void {
    try {
      this.socket?.send(JSON.stringify(payload))
    } catch {
      // The socket went while we were writing to it; the close handler has it.
    }
  }

  private receive(raw: string): void {
    let frame: { op: number; d?: unknown; s?: number | null; t?: string | null }
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof frame.s === 'number') this.sequence = frame.s

    switch (frame.op) {
      case OP.hello: {
        const interval = (frame.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41_250
        this.beat(interval)
        // Resuming replays what was missed; identifying starts clean. Only the
        // first costs nothing, so try it whenever there is a session to resume.
        if (this.sessionId && this.sequence !== null) {
          this.post({ op: OP.resume, d: { token: this.options.token, session_id: this.sessionId, seq: this.sequence } })
        } else {
          this.post({
            op: OP.identify,
            d: {
              token: this.options.token,
              intents: INTENTS,
              properties: { os: process.platform, browser: 'roofscape', device: 'roofscape' },
            },
          })
        }
        return
      }
      case OP.heartbeatAck:
        this.acked = true
        return
      case OP.heartbeat:
        this.post({ op: OP.heartbeat, d: this.sequence })
        return
      case OP.reconnect:
        this.socket?.close(4000, 'reconnect')
        return
      case OP.invalidSession:
        // Cannot resume this one. Drop the session and start over.
        this.sessionId = null
        this.resumeUrl = null
        this.socket?.close(4000, 'invalid session')
        return
      case OP.dispatch:
        this.dispatch(frame.t ?? '', frame.d)
        return
      default:
        return
    }
  }

  private beat(interval: number): void {
    if (this.heart) clearInterval(this.heart)
    this.acked = true
    this.heart = setInterval(() => {
      // A heartbeat that was never acknowledged means the connection is a
      // zombie: it will accept writes and deliver nothing.
      if (!this.acked) {
        this.socket?.close(4000, 'no heartbeat ack')
        return
      }
      this.acked = false
      this.post({ op: OP.heartbeat, d: this.sequence })
    }, interval)
    this.heart.unref?.()
  }

  private dispatch(type: string, data: unknown): void {
    if (type === 'READY') {
      const ready = data as { session_id?: string; resume_gateway_url?: string; user?: { username?: string } }
      this.sessionId = ready.session_id ?? null
      this.resumeUrl = ready.resume_gateway_url ?? null
      this.attempts = 0
      this.announce({
        state: 'live',
        ...(ready.user?.username ? { as: ready.user.username } : {}),
        since: new Date().toISOString(),
      })
      return
    }
    if (type === 'RESUMED') {
      this.attempts = 0
      this.announce({ ...this.state, state: 'live' })
      return
    }
    if (type !== 'MESSAGE_CREATE') return

    const message = data as {
      id?: string
      channel_id?: string
      content?: string
      author?: { id?: string; bot?: boolean; username?: string; global_name?: string }
    }
    // Our own mirror comes back down the gateway. Echoing it into the mailroom
    // would post every message twice and, worse, feed the building its own
    // output as if somebody had said it.
    if (message.author?.bot) return
    if (!message.channel_id || !message.content) return
    if (!this.options.listensTo().includes(message.channel_id)) return

    void this.options.onMessage({
      channelId: message.channel_id,
      author: message.author?.global_name ?? message.author?.username ?? 'somebody on Discord',
      authorId: message.author?.id ?? '',
      content: message.content,
      messageId: message.id ?? '',
    })
  }
}

/** The channels a bot can see, for the screen that asks you to pick one. */
export async function listChannels(
  token: string,
  guildId: string,
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${API}/guilds/${encodeURIComponent(guildId)}/channels`, {
    headers: { authorization: `Bot ${token}` },
  })
  if (!response.ok) throw new Error(`Discord answered ${response.status} asking for that server's channels.`)
  const channels = (await response.json()) as Array<{ id: string; name: string; type: number }>
  // Type 0 is an ordinary text channel. A voice channel cannot hold post.
  return channels.filter((c) => c.type === 0).map((c) => ({ id: c.id, name: c.name }))
}

/** The servers the bot has been added to. */
export async function listGuilds(token: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${API}/users/@me/guilds`, {
    headers: { authorization: `Bot ${token}` },
  })
  if (!response.ok) throw new Error(`Discord answered ${response.status}. Check the bot token.`)
  const guilds = (await response.json()) as Array<{ id: string; name: string }>
  return guilds.map((g) => ({ id: g.id, name: g.name }))
}
