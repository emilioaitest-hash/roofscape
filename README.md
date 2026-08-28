# Roofscape

**Every project a building. Every hire a floor.**

Roofscape runs a small service on your machine. You break ground on a **building**
for each company or project you run, and staff it with agents. Every agent gets a
floor, so a tower's height is its headcount — and your **skyline** shows you at a
glance where your effort actually sits.

```
              ╒═══════╕
 ▄▄▄▄▄▄▄▄▄    │▁▁▁▁▁▁▁│
  ┌─────┐     │ ∩ ∩ ∩ │
  │▪ ▪ ▪│     │ ∩ ∩ ∩ │
  │▪ ▪ ▪│     │ ∩ ∩ ∩ │
  │▫ ▫ ▫│     │ ∩ ∩ ∩ │
  │▫ ▫ ▫│     │ ∩ ∩ ∩ │
  │▫ ▯ ▫│     │ ∩ ▯ ∩ │
  ╘═════╛     ╘═══════╛
───────────  ───────────
 Demo Site   Help Center
 2 in hand    5 floors
```

A filled window is a lit one: somebody on that floor has work in hand. In a
terminal and in the app that is marigold; markdown has no colour, so here the
window is simply filled in.

The city is New York, and the ladder is made of real buildings. One pair of
hands is a **newsstand**; then a **bodega**, a **brownstone** with a stoop, a
**cast-iron loft** with the fire escape down its front the way SoHo has them, a
**setback tower**, a **landmark** with a spire, and at the top a **supertall**
with the crane still on it.

Nobody chooses the form — it follows the headcount, because a home screen should
tell you something true from across the room.

## What it does

- **A manager** on the top floor breaks your goals into tasks and assigns them.
- **A coder** works in its own git worktree, on its own branch. Never your checkout.
- **A reviewer** reads what came back — and holds no tool that can write, not even
  a shell, so it cannot quietly become the author.
- **Everything is remembered**, in archives below ground, and recalled on demand
  rather than pasted into every prompt.
- **You approve** anything that reaches the outside world: publishing, sending,
  deploying, spending, merging to main. The building waits for your answer.

## What it looks like

The home screen is a drawing, not a dashboard, and the drawing is the product.

It is printed the way a cheap and lovely two-colour book is printed: warm paper,
one plate of warm-black line, one plate of flat colour, and the colour landing a
millimetre off the ink. The offset is seeded per building, so no two are wrong by
the same amount — and hovering a building snaps its colour plate into register.

Two colours mean things, and they are the only saturated colours in the product.
**Marigold is light**: a window with somebody behind it, work in hand. Brighter,
with a small dark figure at the counter, means that floor is running right now.
**Vermilion is you**: a pin pushed into the roof of a building that is waiting on
your say-so. Nothing else is either colour. There is no brand colour, and the
primary button is ink.

`docs/DESIGN.md` is the whole system, and it is enforced by a test rather than by
good intentions — a colour nobody named, or marigold on a button, fails the
build. Decisions 0015 to 0017 record what the language cost.

## Getting started

Download it from **[roofscape.vercel.app](https://roofscape.vercel.app)**. The app
carries the service inside it, so there is no Node to install and no build step.
macOS will ask whether the developer can be verified the first time, because the
app is signed with its own certificate rather than one Apple has certified: open
**System Settings → Privacy & Security** and click **Open Anyway**. Once per
version.

Roofscape supplies no model, so the first screen's job is to get you one, and it
can finish that itself:

- If **Claude Code** is installed and logged in, that is already enough —
  Anthropic floors run on your subscription and need no API key.
- Otherwise paste a key for any provider into the app and it is connected. There
  is nothing to install in a terminal first.

Then break ground, take somebody on, and put a goal to the building. The screen
always names the one next thing to do; a building with nobody in it does nothing,
and says so rather than showing you a zero.

### From source, and the terminal

To run it from a checkout, or to get the `roofscape` command:

```sh
npm install
npm run build
npm link          # puts `roofscape` on your PATH

roofscape doctor
npm run desktop   # the app, from this checkout
```

(Without `npm link`, every command below works as
`./node_modules/.bin/roofscape …`.)

`doctor` tells you what it can reach. To connect a provider from here instead of
from the app:

```sh
roofscape provider add anthropic --env ANTHROPIC_API_KEY
```

Then:

```sh
roofscape ground "My Project" --workspace ~/code/my-project
roofscape hire coder
roofscape hire reviewer
roofscape goal "Add a farewell function to greet.js"
roofscape                       # the skyline
```

## Running it as a service

The CLI is one window onto the work. The daemon is the work:

```sh
roofscaped                    # http://127.0.0.1:7717
```

It prints a URL with a token in it. Open that and you get the dashboard: the
skyline, who works where, what is in hand, the approval desk, and a box to put a
goal to a building — with progress streaming in live as it is worked. The
buildings are drawn by the same renderer the terminal uses, so the two cannot
drift apart.

It binds to loopback and requires a bearer token, kept in your data directory at
`daemon.token`. That is not ceremony: the daemon starts agents, agents run shell
commands, and an open port that does that is a remote shell with a nice API. It
will bind elsewhere if you set `ROOFSCAPE_HOST`, and says so loudly when you do.

`GET /api/skyline`, `GET /api/buildings/:id`, `POST /api/buildings/:id/goal`,
`GET /api/approvals`, and `GET /api/events` — a live stream of progress, so a
dashboard can watch a goal being worked rather than poll for it. This is what the
dashboard and the desktop app talk to, and what runs on a VPS when you want work
finishing overnight.

## Work that recurs

```sh
roofscape schedule "Check the build still passes" --every daily --at 09:00
roofscape schedules
```

The service checks standing orders every thirty seconds while it is up. A machine
that was asleep for a week runs each order **once** when it wakes, not seven
times — the schedule moves forward from now rather than from when it was due,
because coming back to a week of catch-up work is worse than missing it.

An order whose building has nobody in it says so and moves on, rather than
failing quietly.

## Bring your own model

Roofscape supplies no model. It supplies a chooser: Anthropic, OpenAI, Google,
OpenRouter, xAI, Groq, DeepSeek, Ollama, LM Studio — picked **per role**, because
a manager wants judgement and a curator just wants to be cheap.

Two engines run a turn, with an identical tool row either way: `direct` against
any provider's API, and `claude-agent-sdk` through the Claude Code you already
have. Which engine ran a turn changes what it cost, never what the agent could do.

## Asking across everything

```sh
roofscape ask "what is everyone working on?"
roofscape ask "which building should handle the login bug?"
roofscape ask "fix the pricing table on the marketing site"
```

Buildings deliberately share nothing, so nobody inside one can see the skyline.
The concierge in the lobby can: it reads any building, searches any archive, and
hands work to the building whose job it is. It holds nothing that can change
anything — no files, no shell, no hiring. Somebody who can see everything should
be able to alter very little.

## What it may spend

```sh
roofscape budget --monthly 500000
roofscape budget
```

Output tokens, not money — money depends on which provider answered, and the
number would be a guess dressed up as a fact. A building at its monthly ceiling
refuses to start work and says how to lift it, rather than quietly carrying on.

## When things go wrong

A provider that will not answer does not end the work. A rate limit, an outage or
a stale key moves that floor to the next provider that suits its role — a manager
on a smaller model is worse than a manager on the right one, and much better than
no manager. A model id that does not exist is *not* retried elsewhere, because
every provider will refuse it.

Work the reviewer sends back goes back to whoever did it, once, with the verdict
in front of them. After that it is left for you: two who disagree do not converge
by being asked again.

A goal that came back having done nothing says so, and says why. It is the moment
the product is most tempted to congratulate itself, and the one where a green
tick would be a lie.

## Status

M0 is done: a real goal on a real repository produces a reviewed branch, with a
human touching nothing but the approval prompts. See `docs/ROADMAP.md` for what
comes next, and `docs/decisions/` for why things are the way they are — each
record says what the choice **cost**, not only what it bought.

**Not yet safe to hand to a stranger.** Agents are confined to their building's
workspace by path and an allowlisted shell, which is proportionate for running
your own work on your own machine. Container-per-building isolation lands before
anyone else runs it. See `SECURITY.md`.
