# 0011 — Recall works with nothing installed, and embeddings are optional

**Supersedes 0005**, which made local embeddings via Ollama the default.

**Decided.** Keyword recall — SQLite FTS5 with BM25 — is the default and is
always available. Meaning-based recall is an optional addition, either from a
local embedding model or a hosted one, and nothing about the archives stops
working when neither is configured.

**Why the change.** 0005 assumed Ollama was present because it happened to be on
the development machine. It was removed, and the decision turned out to rest on
a coincidence rather than a reason. Worse, it would have been wrong for everyone
else too: a downloadable app that requires a separate 13GB install before its
memory search works is one most people will never see working.

**What replaces the missing half.** Two things carry more weight than the vector
search would have:

The curator writes notes to be found. A note recorded as "the deploy target is
Fly, not Vercel" is retrievable by keyword; one recorded as "changed it on
Tuesday" is not, whatever is indexing it. Consolidating episodes into stated
facts is already the curator's job, and it improves keyword recall directly.

Pinned memory carries what must never be missed. Anything that would be a
disaster to fail to recall does not depend on search at all — it is in the core
of every prompt.

**Cost, stated plainly.** Keyword search misses synonyms. Asking "how did we fix
the login problem" will not find a note titled "auth token refresh" — no shared
words, exactly the right note. That is a real gap and this decision accepts it
rather than pretending otherwise. It is narrowed, not closed, by the curator
writing plainly, and it closes properly when embeddings are configured.

**When embeddings arrive**, they rank alongside keyword hits rather than
replacing them, because each finds what the other misses. The schema already
carries the column.
