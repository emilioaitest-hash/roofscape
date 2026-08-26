# Belfry

**A building for your work.** Each floor is a company or project, staffed by AI
agents that remember what they have done and hand work to one another.

Belfry is a downloadable app. It installs a small always-running service on your
machine — the *building* — and gives you a window into it. You add a **floor**
for each company or project you run. Every floor gets a **manager** who breaks
goals into tasks and assigns them, a **hiring manager** who drafts new staff when
the floor needs a skill it doesn't have, and whichever specialists you approve:
coder, reviewer, researcher, writer, designer, marketer, ops.

Three things make it different from a chat window:

- **Staff persist.** Each agent keeps its own memory — private to it, the way one
  person's notes are their own. It gets better at your work over time.
- **Memory stays cheap.** Nothing is pasted wholesale into a prompt. Agents look
  things up when they need them, so a floor with ten years of history costs about
  the same per turn as one on its first day.
- **You stay in charge.** Hires need your sign-off. So does anything that reaches
  the outside world — publishing, sending, deploying, spending.

Belfry brings no model of its own. Point it at whichever provider you already pay
for and it will use that.

> Status: early construction. See `docs/ROADMAP.md`.

## Documentation

- `docs/ARCHITECTURE.md` — how it is built and why
- `docs/ROADMAP.md` — what ships when
- `docs/decisions/` — the record of each decision, and what it cost
