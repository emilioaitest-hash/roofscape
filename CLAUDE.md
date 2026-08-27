# Working in this repository

Read `docs/ARCHITECTURE.md` for what each piece is for, `CONTRIBUTING.md` for how
a change is expected to look, and `docs/decisions/` for why things are the way
they are. This file is only for what those do not say: the commands, and the
things that have already gone wrong.

## Commands

    npm install
    npm run typecheck
    npm test            # builds first, then runs the built tests
    npm run desktop     # the desktop app, from this checkout
    npm run desktop:dist  # installers into apps/desktop/release

Node 24 or later, and it is not optional: storage uses `node:sqlite`, which is
built into Node. There is no native module anywhere in the tree, and it should
stay that way — it is what makes the desktop app a single bundled file.

Tests run from `dist/`, not from source, so a build has to happen first. `npm
test` does that for you; `node --test` on its own will run stale code.

## The shape of it

    packages/core   everything that does work: stores, agents, tools, providers
    apps/daemon     the HTTP service, and the dashboard it serves
    apps/cli        the terminal window onto the daemon
    apps/desktop    an Electron shell that carries the daemon inside it
    website/        the download page, deployed separately on Vercel

The product's name lives in `packages/core/src/brand.ts` and nowhere else. The
internal packages are `@app/*` on purpose so that naming the product is one file
rather than a rename across the tree.

`website/` is deliberately outside the npm workspaces. It has React and Next in
it, which the daemon and the CLI have no business resolving.

## The data directory

Everything an installation knows lives in `~/.roofscape`: the skyline database,
one folder per building, the daemon's token and its lock. None of it is in this
repository and none of it is in the packaged app — `dataRoot()` finds it at
runtime, which is why a build you downloaded and a build you made from source
show the same buildings on the same machine. When someone reports that the app
shipped their data, this is what they have found, and the answer is in
`packages/core/src/store/paths.ts` rather than anywhere in the tree.

`ROOFSCAPE_HOME` overrides it. That is how the tests get their own, and how you
look at a first run without losing what you have.

Quit the app before deleting any of it. The app stops the daemon it started,
which releases the lock and closes the databases; deleting the directory under a
live daemon leaves it writing into files that are no longer there. Then
`rm -rf ~/.roofscape`, which is rebuilt empty on the next start.

## Things that have already gone wrong

**The desktop app has no interface of its own.** It loads the dashboard the
daemon already serves. Do not build a second copy of that page — the whole point
is that the terminal, the browser and the app cannot drift apart.

**Do not import the `@app/core` barrel into the Electron main process.** It
re-exports the whole of core, which drags the provider SDKs in, and one of them
calls `createRequire(import.meta.url)` — undefined once esbuild emits CommonJS.
The app will not boot. Import the specific modules instead; the main bundle is
8kb because of it.

**`apps/desktop/build/` is source, not output.** It holds electron-builder's
`buildResources`, including the signing hook. The root `build/` ignore rule
swallowed it once: every release build failed on a module it could not find,
while building here kept working because the file was on disk. There is an
explicit un-ignore for it now.

**Verify packaging from a clean checkout.** The bug above passed every local
test and failed every CI run, and the difference was a file git had never been
given. Building here and building from what is committed are different tests.

**Verify the shipped artifact, not the local build.** A signature that is valid
on this machine says nothing about the one people download. Fetch the published
file and check that.

**A second service needs a second port, not just a second data directory.** The
single-instance lock is per data directory — `daemon.pid` lives inside
`dataRoot()` — so a fresh `ROOFSCAPE_HOME` walks straight past it and collides on
the port instead. The failure is an unhandled `EADDRINUSE`, not the message
written for two services meeting. Set `ROOFSCAPE_PORT` as well.

**The macOS app does not inherit your shell.** An app launched from Finder gets
launchd's environment, so `ROOFSCAPE_CLAUDE_BIN=none` exported in a terminal does
nothing to the installed app. `launchctl setenv` reaches it, and does not survive
a reboot. Run the app from a terminal and the variable behaves as written.

## Releases and the app

Merging to main publishes a release. The patch number is the CI run number, so
every merge is a version the updater will see as newer; major and minor are a
deliberate edit to `apps/desktop/package.json`.

The draft release is created once, before the platform builds run. It used to be
created by whichever platform got there first, and because a draft has no git tag
behind it, GitHub accepted three drafts with the same name — the macOS disk image
and the Windows installer landed in different releases.

macOS builds are **ad-hoc signed, not notarized**. That is the difference between
"damaged and can't be opened", which is a dead end, and the ordinary
unverified-developer prompt, which a person can get past. It is not a substitute
for a Developer ID: without one, macOS auto-update does not work at all, because
Squirrel validates the signature before installing. Windows and Linux update
normally.

`executableName` belongs under `linux` only. At the top level it also renames the
macOS bundle.

## The website

Two settings live in the Vercel project rather than in this repository, and both
are load-bearing:

- **Root Directory must be `website`**, or Vercel builds the workspace root,
  finds no `next`, and fails with `NEXT_NO_VERSION`.
- **Framework Preset must stay Next.js.** `/api/download` is a server route; if
  the preset is cleared the page is published as static files and every download
  button stops working.

The download route is never cached. The release and the site are published by the
same push and the site finishes first, so a cached lookup captures the *previous*
release and hands out the old binary after the new one exists.
