import { Downloads } from './Downloads'
import { latestRelease, PLATFORMS, type Platform } from './release'

/**
 * The skyline, printed the way the app prints one: two plates.
 *
 * The ink plate carries every line, and every window on it is an empty socket.
 * The colour plate carries only the lit counters, and it lands a fraction off
 * the ink — which is the app's whole visual identity, and its whole hover
 * interaction. See docs/DESIGN.md.
 *
 * Both plates are the same grid, so the second has to be spaced to match the
 * first exactly, line for line. Edit one and you edit both.
 *
 * The blank rows of the colour plate are a single space rather than nothing, for
 * a dull but load-bearing reason: an HTML parser eats the first newline after a
 * `<pre>` tag, so a string that opens with one would land the whole plate a row
 * too high — and the rows it would land on are the roofline.
 */
const INK = [
  '              ╒═══════╕',
  ' ▄▄▄▄▄▄▄▄▄    │▁▁▁▁▁▁▁│',
  '  ┌─────┐     │ ∩ ∩ ∩ │',
  '  │▫ ▫ ▫│     │ ∩ ∩ ∩ │',
  '  │▫ ▫ ▫│     │ ∩ ∩ ∩ │',
  '  │▫ ▫ ▫│     │ ∩ ∩ ∩ │',
  '  │▫ ▫ ▫│     │ ∩ ∩ ∩ │',
  '  │▫ ▯ ▫│     │ ∩ ▯ ∩ │',
  '  ╘═════╛     ╘═══════╛',
  '───────────  ───────────',
  ' Demo Site   Help Center',
  ' 2 in hand    5 floors',
].join('\n')

const COLOUR = [' ', ' ', ' ', '   ▪ ▪ ▪', '   ▪ ▪ ▪'].join('\n')

export default async function Home() {
  const release = await latestRelease()
  const available = PLATFORMS.filter((entry) => Boolean(release?.builds[entry as Platform]))

  return (
    <main>
      <p className="wordmark">Roofscape</p>
      <h1>Every project a building. Every hire a floor.</h1>
      <p className="lede">
        A small service that runs companies of agents on your own machine. Break ground on a
        building for each project, staff it, and read the whole operation off a skyline: a
        tower&rsquo;s height is its headcount, its lit windows are the work in hand.
      </p>

      <div className="press">
        {/* Read aloud, box-drawing characters are noise. The drawing says one
            thing, so it says it once. */}
        <pre
          className="plate ink"
          role="img"
          aria-label="Two drawn buildings. Demo Site, four floors with the top two lit and two tasks in hand. Help Center, five floors and nothing in hand."
        >
          {INK}
        </pre>
        <pre className="plate colour" aria-hidden="true">
          {COLOUR}
        </pre>
      </div>
      <p className="caption">
        A lit window is a floor with work in hand. The colour plate lands a fraction off the ink,
        as a two-colour press does — hover the drawing and it snaps into register.
      </p>

      <Downloads version={release?.version ?? null} available={available} />

      <section>
        <h2>What it is</h2>
        <p>
          You break ground on a building for each company or project you run, and staff it with
          agents. A building starts as a shack and grows — single storey, brick walk-up, cast-iron
          block, skyscraper, landmark. Nobody chooses the form. It follows the headcount, because a
          home screen should tell you something true at a glance.
        </p>
        <ul>
          <li>A manager on the top floor breaks your goals into tasks and assigns them.</li>
          <li>A coder works in its own git worktree, on its own branch. Never your checkout.</li>
          <li>A reviewer reads what came back, and holds no tool that can write.</li>
          <li>Everything is remembered, in archives below ground, and recalled on demand.</li>
          <li>You approve anything that reaches the outside world. The building waits.</li>
        </ul>
      </section>

      <section>
        <h2>What it looks like</h2>
        <p>
          Warm paper, one plate of warm-black line, one plate of flat colour, and the colour landing
          a millimetre off the ink. The offset is seeded per building, so no two are wrong by the
          same amount.
        </p>
        <p>
          Two colours mean things, and they are the only saturated colours in the product.{' '}
          <b className="term">Marigold is light</b>: a window with somebody behind it, work in hand.{' '}
          <b className="term">Vermilion is you</b>: a pin pushed into the roof of a building that is
          waiting on your say-so. Nothing else is either colour, there is no brand colour, and the
          primary button is ink.
        </p>
      </section>

      <section>
        <h2>Before you start</h2>
        <p>
          The app brings its own service with it, so there is no Node to install and no build step.
          It supplies no model, though — and the first screen can settle that itself. If you have{' '}
          <a href="https://claude.com/claude-code">Claude Code</a> installed and logged in, that is
          already enough. Otherwise paste a key for any provider into the app. Nothing has to be
          done in a terminal first.
        </p>
      </section>

      <footer>
        Free and open source.{' '}
        <a href="https://github.com/emilioaitest-hash/roofscape">Source on GitHub</a>
      </footer>
    </main>
  )
}
