# 0007 — Tauri for the desktop app

**Decided.** Tauri.

**Alternative.** Electron.

**Why.** The dashboard is a web app either way, so the shell's only job is to wrap
it, keep the daemon alive, and sit in the menu bar. Tauri does that in about 10MB
against Electron's 150MB, and uses the system webview instead of shipping a
browser. Electron's advantage is familiarity, which is worth little here because
the shell is thin by design.

**Cost.** A Rust toolchain is needed to build the desktop app — not to run the
daemon or the dashboard, so it is only a cost at M3.
