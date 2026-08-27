'use client'

import { useEffect, useState } from 'react'

/**
 * The download row.
 *
 * Which platform somebody is on is only knowable in the browser, so the guess
 * happens there — but every choice is a plain link, and all four are rendered
 * either way. Somebody with scripting off still gets every download; they just
 * pick their own.
 */

const ALL = [
  { id: 'mac-arm64', label: 'macOS (Apple silicon)' },
  { id: 'mac-x64', label: 'macOS (Intel)' },
  { id: 'win', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
] as const

type Platform = (typeof ALL)[number]['id']

function guess(): Platform {
  if (typeof navigator === 'undefined') return 'mac-arm64'
  const ua = navigator.userAgent
  if (/Win/i.test(ua)) return 'win'
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux'
  // Apple silicon does not announce itself in the user agent. Everything Apple
  // has shipped for years is arm64, so that is the better default of the two.
  return 'mac-arm64'
}

export function Downloads() {
  // Rendered the same on the server and on the first client pass, then
  // corrected — otherwise the markup the server sent and the markup React
  // expects disagree, and React throws the whole tree away.
  const [platform, setPlatform] = useState<Platform>('mac-arm64')
  useEffect(() => setPlatform(guess()), [])

  const primary = ALL.find((entry) => entry.id === platform)!
  const rest = ALL.filter((entry) => entry.id !== platform)

  return (
    <>
      <div className="downloads">
        <a className="primary" href={`/api/download?platform=${primary.id}`}>
          Download for {primary.label}
        </a>
        {rest.map((entry) => (
          <a key={entry.id} className="secondary" href={`/api/download?platform=${entry.id}`}>
            {entry.label}
          </a>
        ))}
      </div>
      <p className="fineprint">
        Free and open source. Not yet signed, so your machine will ask whether you trust it.
      </p>
    </>
  )
}
