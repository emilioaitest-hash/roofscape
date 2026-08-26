# 0001 — TypeScript everywhere

**Decided.** Node 24 and TypeScript for the daemon, the dashboard, the CLI and
the desktop shell.

**Alternative.** Python, which is what Hermes is written in and what most agent
tooling assumes.

**Why.** The owner does not write code, so the deciding factor is not familiarity
but how few moving parts have to be kept alive. One language covers the service,
the interface and the app; one toolchain builds all three; one dependency file
describes them. Python would have meant a second runtime the moment a UI existed.
