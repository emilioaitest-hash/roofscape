# 0004 — Two layers: providers, and engines

**Decided.** A *provider* layer over a unified multi-vendor SDK, and an *engine*
layer describing how a turn is run: `direct` (our own tool loop) or
`claude-agent-sdk` (the same tools, run through a local Claude Code install).
Model choice is per role.

**Alternative.** Hand-write an adapter per vendor; or pick one vendor.

**Why.** The requirement was Hermes-grade flexibility, and a unified SDK gets
twenty vendors on day one. The engine split exists because a Claude subscription
carries higher limits than metered API billing, and a person who has one should
be able to use it — without Roofscape ever holding someone else's credentials.
Identical tools on both engines means the choice never changes what an agent can
do, only what it costs.
