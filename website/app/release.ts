/**
 * What the newest release actually contains.
 *
 * Asked once and shared by the page and the download route, so the page never
 * offers a button that the route cannot honour. A release that is still a draft
 * does not appear here at all — GitHub omits drafts from `releases/latest`, and
 * that is the behaviour we want: a half-uploaded release is not a download.
 */

const REPO = 'emilioaitest-hash/roofscape'

export const PLATFORMS = ['mac-arm64', 'mac-x64', 'win', 'linux'] as const
export type Platform = (typeof PLATFORMS)[number]

export const LABELS: Record<Platform, string> = {
  'mac-arm64': 'macOS (Apple silicon)',
  'mac-x64': 'macOS (Intel)',
  win: 'Windows',
  linux: 'Linux',
}

/** electron-builder's artifact names, matched by the shape it gives them. */
const WANTED: Record<Platform, (name: string) => boolean> = {
  'mac-arm64': (n) => n.endsWith('.dmg') && n.includes('arm64'),
  'mac-x64': (n) => n.endsWith('.dmg') && !n.includes('arm64'),
  win: (n) => n.endsWith('.exe'),
  linux: (n) => n.endsWith('.AppImage'),
}

export interface Release {
  version: string
  /** Direct file URLs, by platform. A platform whose build failed is absent. */
  builds: Partial<Record<Platform, string>>
}

interface Asset {
  name: string
  browser_download_url: string
}

export async function latestRelease(): Promise<Release | null> {
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    // Long enough that a busy day does not exhaust the unauthenticated rate
    // limit, short enough that a new release is offered within the hour.
    next: { revalidate: 600 },
  })
  // 404 is the ordinary answer when nothing has been published yet.
  if (!response.ok) return null

  const release = (await response.json()) as { tag_name?: string; assets?: Asset[] }
  const assets = release.assets ?? []

  const builds: Partial<Record<Platform, string>> = {}
  for (const platform of PLATFORMS) {
    const asset = assets.find((candidate) => WANTED[platform](candidate.name))
    if (asset) builds[platform] = asset.browser_download_url
  }

  if (Object.keys(builds).length === 0) return null
  return { version: (release.tag_name ?? '').replace(/^v/, ''), builds }
}
