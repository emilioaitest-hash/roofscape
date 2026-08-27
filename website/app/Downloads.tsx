'use client'

import { useEffect, useState } from 'react'
import { LABELS, PLATFORMS, type Platform } from './release'

/**
 * The download row.
 *
 * Every button here is one that works. Which platforms exist is decided on the
 * server from the actual release, so a build that failed is simply not offered
 * — nobody is sent to a file that is not there, and nobody is sent to GitHub to
 * go looking for it.
 */

function guess(): Platform {
  if (typeof navigator === 'undefined') return 'mac-arm64'
  const ua = navigator.userAgent
  if (/Win/i.test(ua)) return 'win'
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux'
  // Apple silicon does not announce itself in the user agent. Everything Apple
  // has shipped for years is arm64, so that is the better default of the two.
  return 'mac-arm64'
}

export function Downloads({ version, available }: { version: string | null; available: Platform[] }) {
  // Rendered the same on the server and on the first client pass, then
  // corrected — otherwise the markup the server sent and the markup React
  // expects disagree, and React throws the whole tree away.
  const [platform, setPlatform] = useState<Platform>('mac-arm64')
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => {
    setPlatform(guess())
    const asked = new URLSearchParams(window.location.search).get('unavailable')
    if (asked) setMissing(asked)
  }, [])

  if (available.length === 0) {
    return (
      <p className="fineprint">
        The first builds are on their way. This page will offer them as soon as they finish —
        there is nothing to go and find elsewhere.
      </p>
    )
  }

  const ordered = PLATFORMS.filter((entry) => available.includes(entry))
  const primary = ordered.includes(platform) ? platform : ordered[0]!
  const rest = ordered.filter((entry) => entry !== primary)

  return (
    <>
      {missing ? (
        <p className="fineprint">
          There is no {LABELS[missing as Platform] ?? 'that'} build in the current release yet.
        </p>
      ) : null}
      <div className="downloads">
        <a className="primary" href={`/api/download?platform=${primary}`}>
          Download for {LABELS[primary]}
        </a>
        {rest.map((entry) => (
          <a key={entry} className="secondary" href={`/api/download?platform=${entry}`}>
            {LABELS[entry]}
          </a>
        ))}
      </div>
      <p className="fineprint">
        {version ? `Version ${version}. ` : ''}
        Free and open source.
      </p>
      {primary.startsWith('mac') ? (
        <p className="fineprint">
          <strong>First time on macOS:</strong> right-click the app and choose <em>Open</em>, then
          <em> Open</em> again. macOS will say the developer cannot be verified, because the app
          carries its own signature rather than one Apple has certified. Once per version.
        </p>
      ) : null}
    </>
  )
}
