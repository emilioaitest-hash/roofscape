# 0003 — Memory is retrieved, never injected wholesale

**Decided.** A turn carries a fixed ~1–2k token core. Everything else is fetched
through a `recall` tool: FTS5 keyword search and vector similarity together,
ranked by recency, importance and usefulness. A nightly curator consolidates.

**Alternative.** Paste a memory file into every prompt, as most harnesses do.

**Why.** Injection makes cost grow with history, which means the system gets more
expensive precisely as it gets more valuable, and eventually the memory file has
to be truncated — losing the oldest knowledge, which is usually the load-bearing
kind. Retrieval keeps per-turn cost flat in archive size.

**Cost.** An agent can fail to look something up that it should have. Mitigated by
pinned facts in the core and by the curator promoting what recurs.
