# Roadmap

Each milestone ends with something that works, not something that compiles.

## M0 — One floor does real work
The daemon, SQLite state, the provider layer with a working model chooser, the
message bus, and three agents: manager, coder, reviewer. A floor is created from
a charter. A goal becomes tasks, the tasks get done in a git worktree, the branch
comes back for review. A minimal CLI drives all of it.

**Done when** a real goal on a real repo produces a reviewed branch without a
human touching anything but the approval prompts.

## M1 — Memory
Three scopes, four layers. The `recall` tool over FTS5 plus vectors. Local
embeddings. The nightly curator. Token accounting per turn, so the flat-cost
claim is measured rather than asserted.

**Done when** an agent's second week is visibly better than its first, and the
per-turn token count has not risen with it.

## M2 — Hiring
The hiring manager, the stock roster, agent definitions as data, the approval
flow for hires, archive-and-handover on dismissal.

**Done when** a floor that needs a skill it lacks proposes a hire, you approve,
and the new agent picks up work.

## M3 — The building you can see
Web dashboard: the building, its floors, org charts, live tasks, the approval
queue, the memory browser, spend. Tauri desktop shell around it. Installer.

**Done when** someone who cannot code can add a floor and follow its work.

## M4 — Always on
Docker image, VPS deployment, worker registration with capability tags so
machine-specific tasks wait for the right machine. Phone access as a PWA.

**Done when** work completes overnight with every local machine shut.

## M5 — Other people
Multi-tenancy, onboarding, bring-your-own-credentials, billing, licensing, the
agent-template marketplace. Container-per-floor isolation before any public
release.

**Done when** somebody who is not the author runs a floor successfully without
being talked through it.
