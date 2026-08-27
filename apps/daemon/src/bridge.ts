import {
  SkylineStore, BuildingStore, DiscordBridge, readBridgeConfig,
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
 *   one through the whole runtime. Watching for post newer than the last thing
 *   sent is one indexed query every few seconds and it cannot miss anything,
 *   including messages written while the bridge was disconnected.
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

export interface BridgeDeps {
  events: EventStream
  /** Starting a goal is the daemon's business, not the bridge's. */
  startGoal: (building: BuildingId, goal: string, source: string) => string
}

export class Mailbridge {
  private client: DiscordBridge | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private channels: Record<string, string> = {}
  /** Per building, the timestamp of the last message mirrored out. */
  private watermark = new Map<string, string>()
  private mirrorAll = false
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

    // Start the watermark at now, so switching the bridge on does not replay a
    // year of correspondence into a channel.
    const at = new Date().toISOString()
    for (const buildingId of Object.keys(this.channels)) {
      if (!this.watermark.has(buildingId)) this.watermark.set(buildingId, at)
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
      const since = this.watermark.get(buildingId)
      if (!since) continue

      let fresh: Message[] = []
      let staff = new Map<string, Floor>()
      try {
        const store = BuildingStore.open(buildingId as BuildingId)
        try {
          fresh = store.conversation({ since, limit: 25 })
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

      this.watermark.set(buildingId, fresh[fresh.length - 1]!.createdAt)

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

    const text = message.content.trim()
    if (text.length === 0) return

    const store = BuildingStore.open(buildingId)
    try {
      const manager = store.floorByRole('manager')
      if (!manager) {
        void this.client?.send(message.channelId, 'There is nobody in that building to read this yet.')
        return
      }

      // A goal is an explicit request, never an inference. Somebody chatting in
      // a channel should not be able to spend money by accident, and the bot
      // saying "I have started work on that" when they were talking to a
      // colleague is worse than useless.
      if (text.toLowerCase().startsWith(GOAL_PREFIX)) {
        const goal = text.slice(GOAL_PREFIX.length).trim()
        if (goal.length === 0) return
        store.post({ kind: 'note', from: null, to: manager.id, body: `${message.author} (Discord): ${goal}` })
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
        body: `${message.author} (Discord): ${text}`,
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
  return `**${name(message.from)}** ${verb} **${name(message.to)}**\n${message.body.slice(0, 1600)}`
}
