# 0007 — Tauri for the desktop app

**Superseded by 0012**, which chose Electron. The reasoning below held while the
daemon was something the owner installed separately; it stopped holding once the
daemon had to ship inside a downloadable app.

**Decided.** Tauri.

**Alternative.** Electron.

**Why.** The dashboard is a web app either way, so the shell's only job is to wrap
it, keep the daemon alive, and sit in the menu bar. Tauri does that in about 10MB
against Electron's 150MB, and uses the system webview instead of shipping a
browser. Electron's advantage is familiarity, which is worth little here because
the shell is thin by design.

**Cost.** A Rust toolchain is needed to build the desktop app — not to run the
daemon or the dashboard, so it is only a cost at M3.
