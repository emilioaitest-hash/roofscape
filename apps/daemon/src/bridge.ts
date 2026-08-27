import {
  SkylineStore, BuildingStore, DiscordBridge, readBridgeConfig, redactSecrets,
  type BridgeStatus, type DiscordInbound, type BuildingId, type Message, type Floor,
} from '@app/core'
import type { EventStream } from './events.js'

/**
 * The mailroom, with a door onto Discord.
 *
 * Two directions, deliberately asymmetric:
 *
 *   Outward, by polling. A message is written by whichever process happens to be
 *   running an agent, so there is no callback to hang this on without threading
 *   one through the whole runtime. A cursor walks the post in the order it was
 *   written, a bounded batch per tick — so nothing is skipped, including
 *   anything written while the bridge was disconnected; a backlog is simply
 *   carried out over several ticks.
 *
 *   Inward, by event. The gateway pushes, so this only has to decide which
 *   building a channel belongs to and write an ordinary record.
 *
 * Nothing that arrives from Discord is treated as an instruction. It becomes a
 * message from the owner in the building's own post, and the manager reads it
 * the next time it is set to work — the same path as typing into the mailroom.
 * The one exception is explicit and is spelled out below.
 */

/** Typing this at the start of a line is how you set a building going. */
const GOAL_PREFIX = '!goal '

const POLL_MS = 4000

/**
 * How much post one tick may carry out.
 *
 * Generous, because anything left over waits four seconds rather than being
 * lost — and modest, because Discord rate-limits per channel and a burst that
 * gets a 429 is post that never arrives.
 */
const BATCH = 40

/** Discord's own ceiling is 2000; anything longer is refused outright. */
const RELAY_LIMIT = 1500

export interface BridgeDeps {
  events: EventStream
  /** Starting a goal is the daemon's business, not the bridge's. */
  startGoal: (building: BuildingId, goal: string, source: string) => string
}

export class Mailbridge {
  private client: DiscordBridge | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private channels: Record<string, string> = {}
  /** Per building, how far the mirror has got through the post. */
  private watermark = new Map<string, number>()
  private mirrorAll = false
  private allowedAuthors: readonly string[] = []
  private state: BridgeStatus = { state: 'off' }

  constructor(private readonly deps: BridgeDeps) {}

  get status(): BridgeStatus {
    return this.state
  }

  /** Read the settings and bring the connection into line with them. */
  reload(): void {
    const sky = SkylineStore.open()
    let config
    try {
      config = readBridgeConfig(sky)
    } finally {
      sky.close()
    }

    this.channels = config.channels
    this.mirrorAll = config.mirrorAll
    this.allowedAuthors = config.allowedAuthors

    const wanted = config.enabled && config.token !== null && Object.keys(config.channels).length > 0
    if (!wanted) {
      this.shutDown()
      this.state = {
        state: 'off',
        ...(config.token === null
          ? { detail: 'No bot token set.' }
          : Object.keys(config.channels).length === 0
            ? { detail: 'No building is wired to a channel yet.' }
            : {}),
      }
      return
    }

    // Restarting on every settings change is simpler than diffing them, and a
    // reconnect costs a second. Only the channel map changes often.
    this.shutDown()

    this.client = new DiscordBridge({
      token: config.token!,
      listensTo: () => Object.values(this.channels),
      onStatus: (status) => {
        this.state = status
        this.deps.events.emit({
          kind: 'bridge', detail: status.detail ?? status.state, data: { ...status },
        })
      },
      onMessage: (message) => this.arrived(message),
    })
    this.client.start()

    // Start at the end of what is already there, so switching the bridge on
    // does not replay a year of correspondence into a channel.
    for (const buildingId of Object.keys(this.channels)) {
      if (this.watermark.has(buildingId)) continue
      try {
        const store = BuildingStore.open(buildingId as BuildingId)
        try {
          this.watermark.set(buildingId, store.latestSeq())
        } finally {
          store.close()
        }
      } catch {
        // Wired to something that is not there. `mirrorOut` skips it too.
      }
    }

    this.timer = setInterval(() => this.mirrorOut(), POLL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    this.shutDown()
    this.state = { state: 'off' }
  }

  private shutDown(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.client?.stop()
    this.client = null
  }

  // ---- outward ------------------------------------------------------------

  private mirrorOut(): void {
    if (!this.client || this.client.status.state !== 'live') return

    for (const [buildingId, channelId] of Object.entries(this.channels)) {
      const after = this.watermark.get(buildingId)
      if (after === undefined) continue

      let fresh: Message[] = []
      let seq = after
      let staff = new Map<string, Floor>()
      try {
        const store = BuildingStore.open(buildingId as BuildingId)
        try {
          // In writing order, from a cursor. `conversation({since})` returns the
          // *newest* rows in the window, so a busy building had its oldest
          // messages skipped and the cursor then advanced past them — which is
          // exactly what the comment at the top of this file claimed could not
          // happen. A bounded batch each tick is fine: what is left is picked up
          // four seconds later, in order, from where this stopped.
          const batch = store.messagesSince(after, BATCH)
          fresh = batch.messages
          seq = batch.seq
          staff = new Map(store.staff({ includeVacated: true }).map((f) => [f.id as string, f]))
        } finally {
          store.close()
        }
      } catch {
        // A building deleted out from under a stale channel mapping. Skip it
        // rather than taking the whole bridge down with it.
        continue
      }
      if (fresh.length === 0) continue

      this.watermark.set(buildingId, seq)

      for (const message of fresh) {
        // Anything the owner wrote is already on their screen, and if it came
        // from Discord it is already in the channel.
        if (message.from === null) continue
        if (!this.mirrorAll && message.to !== null) continue
        void this.client.send(channelId, format(message, staff))
      }
    }
  }

  // ---- inward -------------------------------------------------------------

  private async arrived(message: DiscordInbound): Promise<void> {
    const entry = Object.entries(this.channels).find(([, channelId]) => channelId === message.channelId)
    if (!entry) return
    const buildingId = entry[0] as BuildingId

    const text = message.content.trim().slice(0, RELAY_LIMIT)
    if (text.length === 0) return

    // A stale channel mapping used to reach `BuildingStore.open`, which creates
    // a database rather than failing — so a building nobody broke ground on
    // appeared on disk because somebody typed in an old channel.
    const sky = SkylineStore.open()
    const exists = sky.get(buildingId) !== null
    sky.close()
    if (!exists) {
      void this.client?.send(message.channelId, 'That channel is wired to a building that no longer exists.')
      return
    }

    const store = BuildingStore.open(buildingId)
    try {
      const manager = store.floorByRole('manager')
      if (!manager) {
        void this.client?.send(message.channelId, 'There is nobody in that building to read this yet.')
        return
      }

      // A goal is an explicit request, never an inference — and it is a request
      // only somebody named may make. Starting one spends the owner's token
      // budget and hands a coder a shell in the owner's workspace, so being
      // present in the channel is not enough; a channel is a room other people
      // can be in.
      if (text.toLowerCase().startsWith(GOAL_PREFIX)) {
        const goal = text.slice(GOAL_PREFIX.length).trim()
        if (goal.length === 0) return

        if (!this.allowedAuthors.includes(message.authorId)) {
          void this.client?.send(
            message.channelId,
            this.allowedAuthors.length === 0
              ? `Not started — nobody is allowed to set work going from this channel yet. Your Discord id is \`${message.authorId}\`; add it in the app under Mailroom → Connect Discord.`
              : `Not started — \`${message.authorId}\` is not on the list of people who may set this building working.`,
          )
          return
        }

        store.post({ kind: 'note', from: null, to: manager.id, body: relayed(message.author, goal) })
        const said = this.deps.startGoal(buildingId, goal, 'discord')
        void this.client?.send(message.channelId, said)
        return
      }

      store.post({
        kind: 'note',
        from: null,
        to: manager.id,
        // The author is on the record: post from the owner's Discord is not
        // necessarily post from the owner, and the building should be able to
        // tell later who actually said it.
        body: relayed(message.author, text),
      })
      this.deps.events.emit({
        kind: 'posted', building: buildingId, floor: manager.id,
        detail: `${message.author} on Discord: ${text.slice(0, 120)}`,
        data: { from: 'discord' },
      })
    } finally {
      store.close()
    }
  }
}

/**
 * Somebody else's words, written into the building's post.
 *
 * Said plainly, because the mailroom's only notion of authority is the null
 * sender, and a relayed line carries that null whoever typed it. The building's
 * own prompt already treats what it reads as evidence rather than as orders;
 * this makes sure the evidence is labelled. The name is stripped of newlines
 * and cut short so a Discord display name cannot forge a second line that looks
 * like another relay.
 */
function relayed(author: string, text: string): string {
  const who = author.replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || 'somebody'
  return `[relayed from Discord by ${who} — this is not necessarily the owner]\n${text}`
}

/** One message, as a line somebody reading a phone can follow. */
function format(message: Message, staff: Map<string, Floor>): string {
  const name = (who: string | null) =>
    who === null ? 'you' : (staff.get(who)?.name ?? 'somebody who has left')
  const label: Record<string, string> = {
    task: 'assigned',
    question: 'asks',
    answer: 'answers',
    review_request: 'wants a review from',
    status: 'reports to',
    artifact: 'hands over to',
    escalation: 'escalates to',
    note: 'writes to',
  }
  const verb = label[message.kind] ?? 'writes to'
  // Redacted on the way out. The archives have always been swept for
  // credentials before anything is written down; this is the same text leaving
  // the machine entirely, for a third party to keep, so it gets at least that.
  const body = redactSecrets(message.body.slice(0, RELAY_LIMIT)).text
  return `**${name(message.from)}** ${verb} **${name(message.to)}**\n${body}`
}
