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

## M1 — The archives  ◐ in progress
Three scopes, four layers. The `recall` tool over FTS5 plus vectors. Local
embeddings. The nightly curator. Token accounting per turn, so the flat-cost
claim is measured rather than asserted.

**Done when** an agent's second week is visibly better than its first, and the
per-turn token count has not risen with it.

*Done so far: three scopes, four layers, FTS5 recall, automatic history, the
curator, and per-turn token accounting. Outstanding: measuring the flat-cost
claim rather than asserting it, and optional embeddings (see decision 0011).*

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

*Done so far: the daemon, and a dashboard it serves — the skyline, staff, work,
the approval desk, the archives, and a goal box that streams progress live. The
art comes from the same renderer the terminal uses, so the two cannot drift.
Outstanding: breaking ground and hiring from the page rather than the CLI, and
the Tauri shell around it.*

## M4 — Always on
Docker image, VPS deployment, worker registration with capability tags so
machine-specific tasks wait for the right machine. Phone access as a PWA.

**Done when** work completes overnight with every local machine shut.

## M5 — Other people
Multi-tenancy, onboarding, bring-your-own-credentials, billing, licensing, and
the building-template marketplace. Container-per-building isolation before any
public release.

**Done when** somebody who is not the author runs a building successfully without
being talked through it.
