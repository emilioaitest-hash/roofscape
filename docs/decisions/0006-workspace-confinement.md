# 0006 — Confinement now, containers before release

**Decided.** v1 confines agents to the floor's workspace by path, runs shell
commands under an allowlist, and escalates anything unrecognised. Code work
happens in a dedicated git worktree. A container per floor arrives before public
release.

**Alternative.** Containers from the first commit.

**Why.** Docker is not installed on the development machine and an 8GB M1 would
feel it. The security boundary matters most when strangers run this; for a single
author on their own machine, path confinement plus approvals is proportionate.
The interface is written so that the container is a swap behind it.

**Cost.** v1 is not safe to hand to a stranger. Stated plainly in the roadmap:
M5 does not ship without it.
