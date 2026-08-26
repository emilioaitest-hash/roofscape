# 0002 — Agents delegate through a typed bus, they do not converse

**Decided.** Delegation is a tool call that writes a durable, typed record. Each
agent has an inbox. Results come back structured.

**Alternative.** Agents exchange natural-language messages in a shared thread.

**Why.** Conversation between agents costs tokens on every turn for every
participant and has no natural stopping point — two agents will happily agree
with each other until a budget runs out. A record has a definition of done, a
budget, and a result that can be checked. It also makes a floor's history
queryable rather than a transcript nobody reads.

**Cost.** Less emergent, more scaffolding. Anything the agents need to say to
each other must have a message type. Accepted deliberately.
