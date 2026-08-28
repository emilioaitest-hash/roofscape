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
        The first builds are still going through. This page offers them the moment they land, so
        there is nothing to go and find elsewhere in the meantime.
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
      {/* A version is a thing to compare, not to read, so it is set in the
          machine voice — the same rule the app uses for ids and branches. */}
      <p className="fineprint version">{version ? `Version ${version}` : 'The current build'}</p>
      {primary.startsWith('mac') ? (
        <p className="fineprint">
          <strong>First time on macOS:</strong> it will be blocked, and macOS will say Apple cannot
          verify it. Click <em>Done</em>, then open <em>System Settings → Privacy &amp; Security</em>,
          scroll down and click <em>Open Anyway</em>. Once per version. It says that because the app
          is signed with its own certificate rather than one Apple has certified — on macOS 14 and
          earlier, right-clicking and choosing <em>Open</em> did the same job.
        </p>
      ) : null}
    </>
  )
}
