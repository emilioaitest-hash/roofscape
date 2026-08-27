/**
 * Where the bridge's settings live.
 *
 * The skyline database, not a building's: one bot, one connection, however many
 * buildings are wired to it. The token follows the same convention as a provider
 * credential — either the secret, or the name of an environment variable to read
 * it from — so that somebody who does not want a bot token in a file does not
 * have to keep one there.
 */
import type { SkylineStore } from '../store/skylineStore.js'

export interface BridgeConfig {
  /** Resolved, ready to use. Null when nothing is set up. */
  token: string | null
  /** How the token is stored, for a screen that has to show it without leaking it. */
  tokenKind: 'literal' | 'env' | 'none'
  /** The environment variable's name, when that is where the token lives. */
  tokenEnv: string | null
  guild: string | null
  /** buildingId → Discord channel id. */
  channels: Record<string, string>
  /**
   * Mirror the whole mailroom, or only what involves the owner.
   *
   * Off by default. A building's internal post is a working record and most of
   * it is machinery; a phone that buzzes for every `task` message is a phone
   * somebody turns the app off on.
   */
  mirrorAll: boolean
  enabled: boolean
  /**
   * Discord user ids allowed to set a building working with `!goal`.
   *
   * Empty means nobody, and that is the default. A channel is a room other
   * people can be in: starting a goal spends the owner's token budget and hands
   * a coder a shell in the owner's workspace, so it needs somebody named rather
   * than merely somebody present. Ordinary messages are not gated — they are
   * post, and post from a stranger is still just post.
   */
  allowedAuthors: readonly string[]
}

const KEY = {
  token: 'discord.token',
  tokenKind: 'discord.token.kind',
  guild: 'discord.guild',
  channels: 'discord.channels',
  mirrorAll: 'discord.mirrorAll',
  enabled: 'discord.enabled',
  allowedAuthors: 'discord.allowedAuthors',
} as const

export function readBridgeConfig(sky: SkylineStore): BridgeConfig {
  const stored = sky.setting(KEY.token)
  const kind = (sky.setting(KEY.tokenKind) as BridgeConfig['tokenKind'] | null) ?? (stored ? 'literal' : 'none')
  const token =
    kind === 'env' ? (stored ? (process.env[stored] ?? null) : null)
    : kind === 'literal' ? stored
    : null

  let channels: Record<string, string> = {}
  try {
    channels = JSON.parse(sky.setting(KEY.channels) ?? '{}') as Record<string, string>
  } catch {
    // A hand-edited settings row should not stop the daemon booting.
    channels = {}
  }

  let allowedAuthors: string[] = []
  try {
    const parsed = JSON.parse(sky.setting(KEY.allowedAuthors) ?? '[]') as unknown
    // Unreadable means nobody, not everybody. This list is the only thing
    // standing between a channel and the owner's token budget.
    if (Array.isArray(parsed)) allowedAuthors = parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    allowedAuthors = []
  }

  return {
    token,
    tokenKind: kind,
    tokenEnv: kind === 'env' ? stored : null,
    guild: sky.setting(KEY.guild),
    channels,
    mirrorAll: sky.setting(KEY.mirrorAll) === 'true',
    enabled: sky.setting(KEY.enabled) !== 'false',
    allowedAuthors,
  }
}

export interface BridgePatch {
  token?: string | null
  tokenKind?: BridgeConfig['tokenKind']
  guild?: string | null
  channels?: Record<string, string>
  mirrorAll?: boolean
  enabled?: boolean
  allowedAuthors?: readonly string[]
}

export function writeBridgeConfig(sky: SkylineStore, patch: BridgePatch): BridgeConfig {
  if (patch.token !== undefined) {
    sky.setSetting(KEY.token, patch.token ?? '')
    sky.setSetting(KEY.tokenKind, patch.token ? (patch.tokenKind ?? 'literal') : 'none')
  } else if (patch.tokenKind !== undefined) {
    // Changing the kind on its own used to leave the stored secret in place and
    // start reading it as the *name* of an environment variable — which
    // `describeToken` then printed in full, straight back to a screen. There is
    // no reading of a literal that makes sense as a variable name, so the value
    // goes with the kind and has to be given again.
    sky.setSetting(KEY.token, '')
    sky.setSetting(KEY.tokenKind, 'none')
  }
  if (patch.guild !== undefined) sky.setSetting(KEY.guild, patch.guild ?? '')
  if (patch.channels !== undefined) sky.setSetting(KEY.channels, JSON.stringify(patch.channels))
  if (patch.mirrorAll !== undefined) sky.setSetting(KEY.mirrorAll, String(patch.mirrorAll))
  if (patch.enabled !== undefined) sky.setSetting(KEY.enabled, String(patch.enabled))
  if (patch.allowedAuthors !== undefined) {
    sky.setSetting(KEY.allowedAuthors, JSON.stringify([...new Set(patch.allowedAuthors)].filter(Boolean)))
  }
  return readBridgeConfig(sky)
}

/** Never send the secret back to a screen. Enough to recognise, not to use. */
export function describeToken(config: BridgeConfig): string {
  if (config.tokenKind === 'env') {
    return config.token ? `read from $${config.tokenEnv}` : `$${config.tokenEnv} is not set`
  }
  if (config.tokenKind === 'literal' && config.token) {
    return `set, ending ${config.token.slice(-4)}`
  }
  return 'not set'
}
