/**
 * Send somebody to the right file in the newest release.
 *
 * The page never names a version or a filename. It links here, and here asks
 * GitHub what the latest release actually is — so a download link cannot go
 * stale, and cutting a release is the only step in shipping one.
 */

const REPO = 'emilioaitest-hash/roofscape'
const RELEASES = `https://github.com/${REPO}/releases/latest`

/** electron-builder's names, matched by the shape it gives them. */
const WANTED: Record<string, (name: string) => boolean> = {
  'mac-arm64': (n) => n.endsWith('.dmg') && n.includes('arm64'),
  'mac-x64': (n) => n.endsWith('.dmg') && !n.includes('arm64'),
  win: (n) => n.endsWith('.exe'),
  linux: (n) => n.endsWith('.AppImage'),
}

interface Asset {
  name: string
  browser_download_url: string
}

export async function GET(request: Request): Promise<Response> {
  const platform = new URL(request.url).searchParams.get('platform') ?? ''
  const wanted = WANTED[platform]
  if (!wanted) return Response.redirect(RELEASES, 302)

  // A private repository answers 404 here, and so does a repository with no
  // release yet. Both mean "there is nothing to hand over", and the honest
  // answer to that is the releases page rather than a broken file.
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
  if (!response.ok) return Response.redirect(RELEASES, 302)

  const release = (await response.json()) as { assets?: Asset[] }
  const asset = release.assets?.find((candidate) => wanted(candidate.name))
  return Response.redirect(asset?.browser_download_url ?? RELEASES, 302)
}
