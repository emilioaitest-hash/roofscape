# 0005 — Embeddings run locally by default

**Decided.** `nomic-embed-text` via Ollama, with `sqlite-vec` for search.
Hosted embedding APIs are a setting, not a rewrite.

**Alternative.** A hosted embedding API by default.

**Why.** Every memory written would otherwise be a billed API call and a copy of
private notes sent to a third party. Local costs nothing, works offline, keeps
the archive on the machine, and is fast enough — the model is 274MB and runs on
an 8GB M1. Quality is a little below the best hosted models, which matters far
less than it sounds when keyword search runs alongside it.

**Cost.** Ollama becomes a dependency for memory search. Roofscape degrades to
keyword-only if it is absent, rather than failing.
