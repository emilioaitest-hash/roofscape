# 0012 — Electron for the desktop app

**Decided.** Electron. **Supersedes 0007**, which chose Tauri.

**Alternative.** Tauri, plus a bundled Node runtime as a sidecar.

**Why.** Decision 0007 was right about the app it was describing. It assumed the
shell's only job was "to wrap it, keep the daemon alive, and sit in the menu
bar" — a thin window over a daemon the owner had already installed with npm.
Against that, 10MB beat 150MB and nothing else was close.

The premise changed. The app is now something a stranger downloads from a web
page, and a stranger does not have Node 24. So the daemon has to ship *inside*
the app, and the question stops being "how big is the shell" and becomes "how
many runtimes are we shipping".

Electron ships one. Its bundled Node is the runtime, so the daemon is forked
from the app's own binary with `ELECTRON_RUN_AS_NODE=1` and needs nothing
installed. Electron 44 carries Node 24.18.1 — the version this repo already
requires — and `node:sqlite`, which the store depends on, is compiled in and
works. That was measured, not assumed; it is the fact the decision turns on,
because had it been missing, Electron would have needed a Node sidecar *as well*
as its own runtime and Tauri would have won outright.

Tauri would still need that sidecar. A Node 24 binary is ~110MB, so the honest
comparison is ~120MB against ~150MB — not 10 against 150. Twenty percent, paid
for with a Rust toolchain, a hand-rolled Node bundling step, a sidecar lifecycle
written by us rather than by the framework, and Rust cross-compilation for four
targets.

There is a second reason, which is that the update flow is the point of this
milestone. `electron-updater` against GitHub Releases is the most trodden path
in the ecosystem, and it does the exact thing that was asked for: download in
the background, then offer a restart.

**Cost.** About 30MB more on disk and more memory per window than Tauri would
have used, because we ship a browser instead of borrowing the system one. The
daemon and the shell now share a process tree, so a shell crash takes the daemon
with it unless the daemon was already running — which is why the app adopts a
running daemon rather than insisting on owning one.

**Cost of the thing it replaces.** Nothing built yet depended on 0007; it was a
decision, not code. The Rust toolchain it would have required is now not needed.
