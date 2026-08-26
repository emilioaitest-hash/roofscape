# Architecture

What this is made of, and why each piece is shaped the way it is. Decisions with
a real alternative are argued separately in `docs/decisions/`; this file is the
map.


## 1. The shape: a service, and windows into it

The thing that does the work is a **headless daemon**. It holds the buildings,
their staff, their memory, the schedule, and the queue of work. It runs whether
or not any window is open.

Everything a person touches is a **client** talking to that daemon over HTTP and
a websocket: the desktop app, the web dashboard, the CLI, and later a phone.

    ┌─ desktop app (Tauri) ─┐
    ├─ web dashboard ───────┤──▶ HTTP + WS ──▶ ┌──────────────┐
    ├─ CLI ─────────────────┤                  │  the daemon  │──▶ SQLite
    └─ phone (PWA, later) ──┘                  └──────────────┘──▶ providers
                                                      │
                                               workers (this Mac,
                                               a VPS, both)

This split is the most important structural decision, because it lets one build
run three ways without a rewrite:

| Where the daemon runs | What you get | Cost |
|---|---|---|
| On your Mac | Works while the Mac is awake | free |
| On a VPS in Docker | Works at 3am while you sleep | ~$5–20/mo |
| On a VPS, Mac joins as a worker | Cloud does the thinking; tasks needing your machine (Xcode, local files) wait for it | ~$5–20/mo |

v1 ships local. The other two are configuration, not new code — the daemon is a
Docker image with all state under one data directory.

## 2. The skyline

**Every project is its own building.** A building is one company, one product,
one venture — with its own staff, its own memory, its own money, its own repos.
Buildings do not read each other. Your account is the **skyline**: all of them,
side by side, at their true relative heights.

**A building's height is its headcount.** Every agent gets a floor. Hire a
marketer and the tower grows by one. This is not decoration — it is the fastest
honest read on where your effort actually sits. A six-month-old side project that
has quietly grown to eleven floors is telling you something a list of project
names never would.

```
                                     ┌──────┐
                          ┌──────┐   │ mgr  │
                          │ mgr  │   ├──────┤
        ┌──────┐          ├──────┤   │      │
        │ mgr  │          │      │   │      │
        ├──────┤          │      │   │      │
        │      │          │      │   │      │
     ╔══╧══════╧══╗    ╔══╧══════╧═╗ ╔╧══════╧╗
     ║   lobby    ║    ║   lobby   ║ ║ lobby  ║
     ╠════════════╣    ╠═══════════╣ ╠════════╣
     ║  archives  ║    ║ archives  ║ ║archives║
     ╚════════════╝    ╚═══════════╝ ╚════════╝
      side project      the app       the big one
        3 staff          5 staff       8 staff
```

| Term | What it is |
|---|---|
| **Skyline** | Your account. Every building you have broken ground on. |
| **Building** | One company or project. Its own workspace, repos, staff, memory, budget, schedule. |
| **Floor** | One agent. Floors are added as you hire, and the building grows. |
| **Top floor** | The **manager**. Owns the backlog, decomposes goals, assigns work, reviews what returns, escalates to you. It rides up as the building grows — always the top. |
| **Lobby** | Ground floor. Where *you* walk in: the building's charter, its status, the approval desk, and the **hiring manager**'s office. |
| **Archives** | Below ground. All of this building's memory, and the curator who works down there at night. See §4. |
| **Mailroom** | The message bus. Typed, durable, one inbox per floor. |
| **Payroll** | Tokens and cost, metered per task, per floor, per building. Funds budgets now and billing later. |

**A building is the unit of everything.** Backup, export, deletion, handing a
project to a collaborator, and later publishing a building as a template someone
else can break ground from — all of them are "this one building," because a
building shares nothing with its neighbours. This is the main structural gain
over the earlier design, where projects were floors inside one shared building
and the account was the only real boundary.

Roofscape ships with an **empty skyline**. No example projects. The first thing it
asks is what you are breaking ground on.

## 3. How work moves

Agents do not converse. Free-form agent chatter is where token budgets die, and
where two agents talk each other in a circle until something runs out.

Delegation is a **tool call that writes a record**:

    top floor ──assign_task──▶ [task: goal, acceptance criteria, budget, deadline]
                                       │
                                 coder's inbox
                                       │
                                 coder runs its own session, its own context
                                       │
                                 ◀── result ── artifact + summary + cost

Message types: `task`, `question`, `answer`, `review_request`, `status`,
`artifact`, `escalation`. All persisted, so a building's history is queryable
rather than a transcript nobody reads.

**Guardrails from the first commit.** Every task carries a token budget, a
timeout, and a delegation depth. Exceed any and it escalates to a human rather
than spending more. Repeated identical tool failures trip a loop breaker.

**The approval desk, in the lobby.** Anything reaching the world outside the
building stops and waits for you: publishing, sending, deploying, spending money,
merging to `main`, and hiring.

## 4. Memory — the archives

The part that has to be excellent, and the reason for most of what follows.

**Three scopes.** Floor-private (an agent's own notes), building-shared (the
company handbook), and skyline (who you are, facts true across every project).
One hard rule: **no agent writes another agent's memory.** The curator is the
single exception, because tidying is its whole job.

**Four layers.**

1. *Working* — the current session, compressed past a threshold.
2. *Episodic* — what happened. Tasks, decisions, outcomes, timestamped.
3. *Semantic* — durable distilled facts. "Deploy target is Fly, not Vercel."
4. *Procedural* — playbooks. How this building does a release, in the steps that
   actually worked last time.

**Why it stays cheap.** Memory is never pasted into a prompt wholesale. A turn
carries a fixed core of roughly 1–2k tokens — the agent's identity, its pinned
facts, a pointer to the building handbook — and nothing else. The rest arrives
through a `recall` tool that searches on demand: keyword (SQLite FTS5) and
meaning (vector similarity) together, ranked by recency, importance, and how
often a memory has proved useful.

The consequence is the property this system exists for: **cost per turn is flat
in the size of the archive.** A building with 100,000 records prompts at about
the price of one with 100.

**Why it improves.** A nightly **curator** — a cheap or local model, because the
work is bulk and unglamorous — dedupes, merges, promotes recurring episodes into
semantic facts, flags contradictions, decays the stale, and rebuilds indices.
Quality climbs while injection cost stays flat.

**Every record carries** its source, when written, when last used, how often, a
confidence, and an optional expiry. Memory you cannot audit is memory you cannot
trust, so all of it is browsable and editable: pin a fact, correct one, delete
one.

**When an agent is dismissed** its floor's memory is archived, not deleted, and
its replacement is handed a written handover.

## 5. Models

Roofscape supplies no model. It supplies a **chooser**, in the spirit of Hermes:
any provider, any model, picked per role.

- **Providers** — Anthropic, OpenAI, Google, OpenRouter, xAI, Ollama and the rest,
  behind one interface, built on a unified SDK rather than hand-rolled per vendor.
- **Engines** — how a turn runs. `direct` drives our own tool loop against any
  provider. `claude-agent-sdk` runs the same tools through a local Claude Code
  install, letting a turn draw on a Claude subscription and its higher limits
  instead of metered billing. Identical tools either way, so the choice changes
  what a turn costs and never what an agent can do.

Roofscape never holds a subscription on anyone's behalf. It uses credentials the
person running it already owns.

**Routing is per role**, with defaults: a manager wants a strong reasoner, a
coder a strong coding model, a curator something cheap or local.

## 6. Tools and safety

Every agent shares one tool suite — files, shell, git, web, search, memory,
delegation, messaging — so what a floor can do never depends on which vendor
answered.

Code lands through **git worktrees**. An agent given code work gets its own
worktree and branch, never the checkout you have open. Work returns as a branch
for a reviewer floor to read; merging to `main` is yours.

Execution is confined to the building's workspace. Paths outside are refused;
commands run under an allowlist and anything unrecognised escalates. For public
release this hardens into a container per building — the boundary is designed in
now so that becoming a container later is a swap, not a rewrite.

## 7. Storage

SQLite in WAL mode, everything under a single data directory, **one database per
building**. A building is then literally a folder you can copy, back up, hand to
someone, or move to a server — which is what makes it the unit of everything in
§2. A thin skyline-level database holds the list of buildings and your own
profile. Access goes through a repository layer so a hosted deployment can move
to Postgres without touching agent code.

## 8. Stack

TypeScript throughout: Node 24 on the daemon, React in the dashboard, a Tauri
shell for the desktop app, npm workspaces for the monorepo. One language for the
service, the interface and the app.

## 9. Deliberately not here yet

Multi-tenancy, billing, the building-template marketplace, cross-building chat,
phone access, container-per-building isolation. Each is anticipated in the seams
above and scheduled in `docs/ROADMAP.md`. None is built before the first building
does real work, because a product that scales beautifully and does nothing is the
failure mode this design is trying to avoid.
