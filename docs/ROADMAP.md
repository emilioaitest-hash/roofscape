# Roadmap

Each milestone ends with something that works, not something that compiles.

## M0 — One building does real work  ✅ done
The daemon, SQLite state, the provider layer with a working model chooser, the
mailroom, and three floors: manager, coder, reviewer. A building is broken ground
on from a charter. A goal becomes tasks, the tasks get done in a git worktree,
the branch comes back for review. A minimal CLI drives all of it.

**Done when** a real goal on a real repo produces a reviewed branch without a
human touching anything but the approval prompts.

*Proved on 25 August 2026: "pad the seconds to two digits" produced a reviewed
branch with a passing test file, on a Claude subscription, in about four
minutes. The loop also runs in CI against a scripted model, with no key.*

## M1 — The archives  ✅ done
Three scopes, four layers. The `recall` tool over FTS5 plus vectors. Local
embeddings. The nightly curator. Token accounting per turn, so the flat-cost
claim is measured rather than asserted.

**Done when** an agent's second week is visibly better than its first, and the
per-turn token count has not risen with it.

*Three scopes, four layers, FTS5 recall, automatic history, the curator, and
per-turn token accounting. The flat-cost claim is measured rather than asserted:
between ten notes and ten thousand the prompt grows by under forty characters.
Working memory trims a single task's own conversation, which is the cost the
archives never addressed. Optional embeddings remain out, deliberately — see
decision 0011.*

## M2 — Hiring
The hiring manager, the stock roster, agent definitions as data, the approval
flow for hires, archive-and-handover when a floor is vacated.

**Done when** a building that needs a skill it hasn't got proposes a hire, you
approve, and the new floor picks up work.

## M3 — The skyline you can see  ◐ in progress
Web dashboard: the skyline, each building at its true height, org charts, live
tasks, the approval desk, the archives browser, spend. Tauri desktop shell around
it. Installer.

**Done when** someone who cannot code can break ground on a building and follow
its work.

*Done so far: the daemon, and a dashboard it serves. Break ground, hire, put a
goal, approve or refuse, move somebody to another model, search the archives and
send the curator down — all from the page, none of it needing the CLI. The art
comes from the same renderer the terminal uses, so the two cannot drift.
Outstanding: the Tauri shell around it, and an installer.*

## The lobby  ✅ done
Not a numbered milestone — it was reserved in the architecture from the start and
kept being deferred. The concierge sees every building, reads any archive, and
hands work to whichever building's job it is. It holds nothing that can change
anything, because somebody who can see everything should be able to alter very
little. In the terminal as `roofscape ask`, and on the dashboard.

## M4 — Always on
Docker image, VPS deployment, worker registration with capability tags so
machine-specific tasks wait for the right machine. Phone access as a PWA.

**Done when** work completes overnight with every local machine shut.

*Done so far: the daemon; standing orders — `--every daily --at 09:00`, checked
every thirty seconds, catching up once rather than seven times after a machine
has been asleep; and a Docker image with a deploy guide. Outstanding: actually
building that image, which needs a machine with Docker on it — see the last
section of `docs/DEPLOYING.md`, which says plainly that it has never been run.*

## M5 — Other people
Multi-tenancy, onboarding, bring-your-own-credentials, billing, licensing, and
the building-template marketplace. Container-per-building isolation before any
public release.

**Done when** somebody who is not the author runs a building successfully without
being talked through it.
