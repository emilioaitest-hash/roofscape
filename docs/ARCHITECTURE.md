# Architecture

This describes what Belfry is made of and why each piece is shaped the way it is.
Decisions with a real alternative are recorded separately in `docs/decisions/`;
this file is the map, those are the arguments.

## 1. The shape: a service, and windows into it

The thing that does the work is a **headless daemon**. It holds the floors, the
staff, the memory, the schedule, and the queue of work. It runs whether or not
any window is open.

Everything a person touches is a **client** talking to that daemon over HTTP and
a websocket: the desktop app, the web dashboard, the CLI, and later a phone.

    ┌─ desktop app (Tauri) ─┐
    ├─ web dashboard ───────┤──▶ HTTP + WS ──▶ ┌──────────────┐
    ├─ CLI ─────────────────┤                  │  the daemon  │──▶ SQLite
    └─ phone (PWA, later) ──┘                  └──────────────┘──▶ providers
                                                      │
                                               workers (this Mac,
                                               a VPS, both)

This split is the single most important structural decision, because it is what
lets the same build run three ways without a rewrite:

| Where the daemon runs | What you get | Cost |
|---|---|---|
| On your Mac | Works while the Mac is awake | free |
| On a VPS in Docker | Works at 3am while you sleep | ~$5–20/mo |
| On a VPS, Mac joins as a worker | Cloud does the thinking; tasks needing your machine (Xcode, local files) wait for it | ~$5–20/mo |

v1 ships local. The other two are configuration, not new code — the daemon is a
Docker image with all state under one data directory.

It is also, not by coincidence, the shape of a hosted product: one daemon, many
tenants, a building each.

## 2. The building

| Belfry | What it is |
|---|---|
| **Building** | One account. Owns floors, credentials, budget, and what the system knows about you. |
| **Floor** | One company or project. Its own workspace, repos, staff, memory, budget, schedule. Floors do not read each other. |
| **Manager** | Owns the floor's backlog. Decomposes goals, assigns work, reviews what comes back, escalates to you. |
| **Hiring manager** | Reads the floor's needs and drafts a new agent — role, tools, model, memory scope, budget. Installs only with your approval. |
| **Staff** | The specialists. Ship with a stock roster; the hiring manager clones and customises them. |
| **Mailroom** | The message bus. Typed, durable, one inbox per agent. |
| **Archives** | Memory. Three scopes, four layers, one curator. See §4. |
| **Payroll** | Tokens and cost, metered per task, per agent, per floor. Funds budgets now and billing later. |
| **Lobby** | General chat that routes to the right floor. Reserved in the design, built after v1. |

Belfry ships **empty**. No floors, no example projects. The first thing it asks
is what your first floor is for.

## 3. How work moves

Agents do not converse. Free-form agent chatter is where token budgets die and
where two agents talk each other into a loop.

Instead, delegation is a **tool call that creates a record**:

    manager ──assign_task──▶ [task: goal, acceptance criteria, budget, deadline]
                                    │
                             coder's inbox
                                    │
                             coder runs its own session, its own context
                                    │
                             ◀── structured result ── artifact + summary + cost

The message types are `task`, `question`, `answer`, `review_request`, `status`,
`artifact`, and `escalation`. Everything is persisted, so a floor's history is a
queryable record rather than a transcript nobody can read.

**Guardrails, from the first commit.** Every task carries a token budget, a
timeout, and a delegation depth. Exceed any of them and the task escalates to a
human instead of spending more. Repeated identical tool failures trip a loop
breaker.

**The approval queue.** Anything that reaches the world outside the floor stops
here and waits for you: publishing, sending, deploying, spending money, merging
to `main`, and hiring.

## 4. Memory

The part that has to be excellent, and the reason for most of what follows.

**Three scopes.** Agent-private (its own notes), floor-shared (the company
handbook), building (who you are, facts that cross floors). One hard rule: **no
agent writes another agent's memory.** A curator is the single exception, because
tidying is its whole job.

**Four layers.**

1. *Working* — the current session, compressed when it grows past a threshold.
2. *Episodic* — what happened. Tasks, decisions, outcomes, timestamped.
3. *Semantic* — durable distilled facts. "The deploy target is Fly, not Vercel."
4. *Procedural* — playbooks. How this floor does a release, in the steps that
   actually worked last time.

**Why it stays cheap.** Memory is never pasted into a prompt wholesale. A turn
carries a fixed core of roughly 1–2k tokens — the agent's identity, its pinned
facts, a pointer to the floor handbook — and nothing else. Everything else
arrives through a `recall` tool that searches on demand: keyword (SQLite FTS5)
and meaning (vector similarity) together, ranked by recency, importance and how
often the memory has proved useful.

The consequence is the property this system is built for: **cost per turn is flat
in the size of the archive.** A floor with 100,000 records prompts at about the
same price as one with 100.

**Why it improves.** A nightly **curator** — a cheap or local model, because the
work is bulk and unglamorous — dedupes, merges, promotes episodes that keep
recurring into semantic facts, flags contradictions, decays what has gone stale,
and rebuilds the indices. Quality climbs while injection cost stays flat.

**Every record carries** its source, when it was made, when it was last used, how
often, a confidence, and an optional expiry. Memory you cannot audit is memory
you cannot trust, so all of it is browsable and editable in the dashboard: pin a
fact, correct one, delete one.

**When an agent is dismissed** its memory is archived, not deleted, and its
replacement is handed a written handover.

## 5. Models

Belfry supplies no model. It supplies a **chooser**, in the spirit of the one in
Hermes: any provider, any model, picked per role.

Two layers:

- **Providers** — Anthropic, OpenAI, Google, OpenRouter, xAI, Ollama and the rest,
  behind one interface, built on a unified SDK rather than hand-rolled per vendor.
- **Engines** — how a turn is actually run. `direct` drives our own tool loop
  against any provider. `claude-agent-sdk` runs the same tools through a local
  Claude Code installation, which lets a turn draw on a Claude subscription and
  its higher limits instead of metered API billing. Both expose the identical
  tool suite, so an agent behaves the same either way.

Belfry never holds a subscription on anyone's behalf. It uses credentials the
person running it already owns.

**Routing is per role.** A manager wants a strong reasoner; a coder wants a strong
coding model; a curator wants something cheap or local. Each is set independently
and each has a sensible default.

## 6. Tools and safety

Agents share one tool suite — files, shell, git, web, search, memory, delegation,
messaging — so a floor's capabilities do not depend on which vendor answers.

Code lands through **git worktrees**. An agent assigned code work gets its own
worktree and branch, never the checkout you have open. Work returns as a branch
for a reviewer agent to read, and merging to `main` is yours to approve.

Execution is confined to the floor's workspace. Paths outside it are refused, and
commands run under an allowlist with anything unrecognised escalating to you. For
public release this hardens into a container per floor; the boundary is designed
in now so that becoming a container later is a swap, not a rewrite.

## 7. Storage

SQLite in WAL mode, one database per building, everything under a single data
directory. That makes the whole state of a building a folder you can copy, back
up, or move to a server. Access goes through a repository layer so that a hosted
multi-tenant deployment can move to Postgres without touching the agent code.

## 8. Stack

TypeScript throughout: Node 24 on the daemon, React in the dashboard, a Tauri
shell for the desktop app, npm workspaces for the monorepo. One language for the
service, the interface and the app — which matters most for the person who has to
maintain it, and later for anyone hired to help.

## 9. What is deliberately not here yet

Multi-tenancy, billing, the agent-template marketplace, the Lobby, phone access,
and container-per-floor isolation. Each is anticipated in the seams above and
scheduled in `docs/ROADMAP.md`. None is built before the first floor does real
work, because a product that scales beautifully and does nothing is the failure
mode this design is trying to avoid.
