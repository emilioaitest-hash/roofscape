import { Downloads } from './Downloads'
import { latestRelease, PLATFORMS, type Platform } from './release'

/** The same drawing the terminal and the dashboard show. */
const SKYLINE = `              ╒═══════╕
 ▄▄▄▄▄▄▄▄▄    │▁▁▁▁▁▁▁│
  ┌─────┐     │ ∩ ∩ ∩ │
  │▫ ▫ ▫│     │ ∩ ∩ ∩ │
  │▫ ▫ ▫│     │ ∩ ∩ ∩ │
  │▫ ▫ ▫│     │ ∩ ∩ ∩ │
  │▫ ▫ ▫│     │ ∩ ∩ ∩ │
  │▫ ▯ ▫│     │ ∩ ▯ ∩ │
  ╘═════╛     ╘═══════╛
───────────  ───────────
 Demo Site   Help Center
4 on staff   5 on staff`

export default async function Home() {
  const release = await latestRelease()
  const available = PLATFORMS.filter((entry) => Boolean(release?.builds[entry as Platform]))

  return (
    <main>
      <h1>Roofscape</h1>
      <p className="tagline">Every project a building. Every hire a floor.</p>

      <pre className="skyline">{SKYLINE}</pre>

      <Downloads version={release?.version ?? null} available={available} />

      <section>
        <h2>What it is</h2>
        <p>
          Roofscape runs a small service on your machine. You break ground on a building for each
          company or project you run, and staff it with agents. Every agent gets a floor, so a
          tower&rsquo;s height is its headcount — and your skyline shows you at a glance where your
          effort actually sits.
        </p>
        <ul>
          <li>A manager breaks your goals into tasks and assigns them.</li>
          <li>A coder works in its own git worktree, on its own branch. Never your checkout.</li>
          <li>A reviewer reads what came back, and holds no tool that can write.</li>
          <li>You approve anything that reaches the outside world.</li>
        </ul>
      </section>

      <section>
        <h2>Before you start</h2>
        <p>
          The app brings its own service with it, so there is nothing to install first. It supplies
          no model, though: it runs on the{' '}
          <a href="https://claude.com/claude-code">Claude Code</a> you already have, or on a key from
          any provider you connect.
        </p>
      </section>

      <footer>
        <a href="https://github.com/emilioaitest-hash/roofscape">Source on GitHub</a>
      </footer>
    </main>
  )
}
