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

Looking at it, which is most of how the drawing gets judged:

    node scripts/seed-demo.mjs              # six buildings worth looking at, into .scratch
    sh scripts/demo-daemon.sh               # serves them on :7788, so your own data is untouched
    sh scripts/shots.sh <tag>               # photographs every screen at once
    sh scripts/verify.sh                    # typecheck, build, test, then photograph
    node scripts/vendor-fonts.mjs           # re-fetch the typefaces (rarely)

    node_modules/.bin/electron scripts/shoot.cjs <url|file> <out.png> [w] [h] [wait] [js…]
    node_modules/.bin/electron scripts/probe.cjs <url> <wait> <js…>

`shoot` answers "does it look right". `probe` evaluates JavaScript in the running
page and prints the result, which answers "is it actually there" — a different
question, and the one that catches a button wired to nothing. Two review findings
were overturned by it and several confirmed; prefer it to reasoning about the DOM.

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

**Name the Electron app before anything asks what it is called.** Unpackaged,
Electron takes the name from `package.json` — `@app/desktop` — and
`getPath('userData')` then has a slash in it, so the single-instance lock cannot
be taken. `requestSingleInstanceLock()` returns false, the app quits before it
opens a window, silently and with exit code 0. `npm run desktop` did nothing at
all and said nothing about it. `app.setName(BRAND.name)` runs before the lock
check now. electron-builder sets `productName` for a packaged build, so this
only ever bit the person developing it.

**`apps/desktop/build/` is source, not output.** It holds electron-builder's
`buildResources`, including the signing hook. The root `build/` ignore rule
swallowed it once: every release build failed on a module it could not find,
while building here kept working because the file was on disk. There is an
explicit un-ignore for it now.

**The dashboard is three files now, and the daemon serves them from a list.**
`index.html`, `app.css`, `app.js` in `apps/daemon/public/`. The list is in
`main.ts` and is deliberately an allowlist rather than a directory walk: that
route answers *before* the token is checked, and `daemon.token` lives one
directory up from the files it serves.

**Rebuild and restart together.** The daemon loads its bundle once, so a rebuild
alone leaves it serving the old API to a freshly built page. The symptom is a
screen that looks right and behaves as though half your changes vanished, which
costs a good twenty minutes before anybody thinks to look at the process.

**A CSS class built from data needs a namespace.** Message kinds were rendered
as `class="kind answer"`, and `.answer` was already the concierge's answer panel
— whose `margin: 0 auto` centred the pill in the middle of every row. They are
`k-answer` and so on now. Anything interpolated from a value gets a prefix.

**Verify packaging from a clean checkout.** The bug above passed every local
test and failed every CI run, and the difference was a file git had never been
given. Building here and building from what is committed are different tests.

**Verify the shipped artifact, not the local build.** A signature that is valid
on this machine says nothing about the one people download. Fetch the published
file and check that.

**A second service needs a second port, not just a second data directory.** The
daemon's own lock is per data directory — `daemon.pid` lives inside
`dataRoot()` — so a fresh `ROOFSCAPE_HOME` walks straight past it and collides on
the port instead. The failure is an unhandled `EADDRINUSE`, not the message
written for two services meeting. Set `ROOFSCAPE_PORT` as well.

**And the app's lock was not per data directory at all.** Electron keys
`userData` off the app's *name*, and `requestSingleInstanceLock()` is keyed off
`userData` — so with the installed app open, `npm run desktop` built the whole
bundle, printed "Done", exited 0, and opened nothing. Every symptom of a build
that worked and no window to show for it, which is the same silent nothing the
`app.setName` note above describes and a different cause. `ROOFSCAPE_HOME` did
not help, because it only ever moved the *daemon's* directory.

Electron's own state lives under `ROOFSCAPE_HOME/electron` now, so one variable
means one whole installation and the lock is per installation. Losing the lock
also says so, and says what to run:

    ROOFSCAPE_HOME=~/.roofscape-dev ROOFSCAPE_PORT=7788 npm run desktop

Quitting on a lost lock is `app.exit(0)`, not `app.quit()` — the latter is a
request, and the rest of `main.ts` goes on running while it is considered.

**The macOS app does not inherit your shell.** An app launched from Finder gets
launchd's environment, so `ROOFSCAPE_CLAUDE_BIN=none` exported in a terminal does
nothing to the installed app. `launchctl setenv` reaches it, and does not survive
a reboot. Run the app from a terminal and the variable behaves as written.

**`tsc --noEmit -p tsconfig.json` checks nothing.** The root config is
`files: []` plus references, so it exits 0 over a broken tree. Typecheck each
package: `npx tsc --noEmit -p packages/core/tsconfig.json`, and the same for
`apps/daemon` and `apps/cli`. `scripts/verify.sh` does it that way.

**A pipeline hides an exit code.** `npm test | tail` returns tail's status, so
`set -e` never fires and a red suite reports success. Redirect to a file and test
the command's own status.

**Anything inside a plot is scaled twice.** By the plot's own `scale(zoom)` and
again by the page fitting the whole SVG to its frame. A length meant to be a
*screen* size — the misregistration, the captions — has to be divided back out by
both, and the composed number is not `svg.getScreenCTM()`; that carries only the
page's half. Measured on a real home screen the two together came to 0.51, which
put the misprint at half a pixel and the caption under each building at 7.7px,
below the floor of the type scale. There is one measured quantity for this now,
`--rs-px`, set by `setSlip()` from *a plot's* transform. Anything screen-sized
derives from it; nothing else should be a bare `px` inside the drawing.

**A backtick inside `CITY_STYLE` ends the template literal.** The whole
stylesheet is a template string in `svg.ts`, so a comment that quotes an
identifier in backticks produces a stream of syntax errors a long way from the
comment. Quote with nothing, or with single quotes.

**The recurring failure in this codebase is a server capability with no caller.**
`POST /api/providers`, the `next` state machine, and `read-work` were each
finished, tested and documented on the daemon with nothing in the browser
reaching them — and the last of the three left the home screen naming an action
the app gave you no way to take. `design.test.ts` now reads every `do:` out of
`api.ts` and fails unless the page has a `case` for it. When you add a state to
the daemon, that test is what will tell you the page never heard of it.

**The design language is Overprint and the city is New York.** `docs/DESIGN.md`
is the whole of it, and decisions 0015–0018 say why. Two rules do the most work:
marigold means light and vermilion means you, so neither may ever fill an
ordinary control — the primary button is `--ink` — and light is a *mark* rather
than an emission, because on paper you cannot emit anything. A window is a
socket; a marigold counter is work in hand. Both rules are enforced by tests, and
both were broken once by code that looked right.

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

So the app does not pretend otherwise. `updater.ts` asks whether an update can
install itself — `process.platform !== 'darwin'` unless a real certificate is
present — and where it cannot, it turns off `autoDownload` and
`autoInstallOnAppQuit` and offers the download page instead of a restart.
Without that it fetched 130MB it could never use, offered "Restart to update",
failed the signature check, and then retried the failing install on every
subsequent quit.

The day a Developer ID appears, set `CSC_LINK` and `CSC_KEY_PASSWORD` and drop
`CSC_IDENTITY_AUTO_DISCOVERY: false` from the release workflow. Nothing else
changes: the ad-hoc hook already stands aside when a real certificate is set,
and the updater's own check flips with it.

`executableName` belongs under `linux` only. At the top level it also renames the
macOS bundle.

**Discord's MESSAGE CONTENT is a switch in their developer portal.** Without it
the bot connects, reports itself live, and receives every message with the
content blank. There is no error and nothing in the product can detect it — a
quiet channel and a misconfigured one look identical from here. It is the first
thing to check when the bridge is connected and nothing arrives, and it is
written down in `docs/DISCORD.md` for the same reason.

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
