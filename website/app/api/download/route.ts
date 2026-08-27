import { latestRelease, PLATFORMS, type Platform } from '../../release'

/**
 * Hand over the file itself.
 *
 * One click on the page starts one download. This redirects to the built
 * artifact directly — not to a releases page, not to anything a person has to
 * read and choose from. If the file is not there, that is this site's problem
 * to explain, so the answer is a page here rather than a trip to GitHub.
 *
 * The redirect is to GitHub's file host rather than a copy streamed through
 * here on purpose: these are ~130MB, and a serverless function that streams one
 * to a slow connection hits its own time limit and truncates the download. A
 * redirect cannot half-finish.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') ?? ''

  const known = (PLATFORMS as readonly string[]).includes(platform)
  if (!known) return Response.redirect(new URL('/?unavailable=unknown', url.origin), 302)

  // Never cached: see latestRelease. A cached answer here hands over an
  // out-of-date binary, which is worse than a slightly out-of-date page.
  const release = await latestRelease(true)
  const file = release?.builds[platform as Platform]
  if (!file) return Response.redirect(new URL(`/?unavailable=${platform}`, url.origin), 302)

  return Response.redirect(file, 302)
}
