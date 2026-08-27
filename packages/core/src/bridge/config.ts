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
}

const KEY = {
  token: 'discord.token',
  tokenKind: 'discord.token.kind',
  guild: 'discord.guild',
  channels: 'discord.channels',
  mirrorAll: 'discord.mirrorAll',
  enabled: 'discord.enabled',
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

  return {
    token,
    tokenKind: kind,
    tokenEnv: kind === 'env' ? stored : null,
    guild: sky.setting(KEY.guild),
    channels,
    mirrorAll: sky.setting(KEY.mirrorAll) === 'true',
    enabled: sky.setting(KEY.enabled) !== 'false',
  }
}

export interface BridgePatch {
  token?: string | null
  tokenKind?: BridgeConfig['tokenKind']
  guild?: string | null
  channels?: Record<string, string>
  mirrorAll?: boolean
  enabled?: boolean
}

export function writeBridgeConfig(sky: SkylineStore, patch: BridgePatch): BridgeConfig {
  if (patch.token !== undefined) {
    sky.setSetting(KEY.token, patch.token ?? '')
    sky.setSetting(KEY.tokenKind, patch.token ? (patch.tokenKind ?? 'literal') : 'none')
  } else if (patch.tokenKind !== undefined) {
    sky.setSetting(KEY.tokenKind, patch.tokenKind)
  }
  if (patch.guild !== undefined) sky.setSetting(KEY.guild, patch.guild ?? '')
  if (patch.channels !== undefined) sky.setSetting(KEY.channels, JSON.stringify(patch.channels))
  if (patch.mirrorAll !== undefined) sky.setSetting(KEY.mirrorAll, String(patch.mirrorAll))
  if (patch.enabled !== undefined) sky.setSetting(KEY.enabled, String(patch.enabled))
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
