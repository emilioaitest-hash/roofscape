# The download page

A small Next.js app, deployed on Vercel, whose whole job is to hand somebody the
right build for their machine.

## How it finds a build

Nothing here names a version or a filename. `app/release.ts` asks GitHub what the
newest published release is and matches its assets by shape — `.dmg` with and
without `arm64`, `.exe`, `.AppImage`. The page then offers only the platforms
that release actually contains, so a build that failed is not offered rather than
offered and broken.

A release still in draft does not appear: GitHub omits drafts from
`releases/latest`, and a half-uploaded release is not a download.

`/api/download?platform=…` redirects to the file. It redirects rather than
streaming a copy through this app because the builds are ~130MB, and a
serverless function streaming one to a slow connection reaches its own time
limit and truncates the download. A redirect cannot half-finish.

## How it looks

Overprint — the same design language as the app, so the page somebody downloads
from and the app they end up in are visibly one object. `docs/DESIGN.md` in the
repository root is the whole system; `app/globals.css` carries the small part of
it a download page needs.

The tokens are **copied, not imported**. The site is deliberately outside the npm
workspaces and shares no build with the daemon, so there is nothing to import
from. That means the two can drift, and the fix when they do is to copy again.

The skyline is printed the way the app prints a building: an ink plate carrying
every line, a colour plate carrying only the lit windows, and the colour landing
a fraction off the ink. Hovering it snaps the plate into register, which is the
app's own hover interaction told in text. Both plates are the same character
grid, so editing one means editing the other.

Two details in there are load-bearing and easy to undo by accident:

- The blank rows of the colour plate are a **single space**, not empty. An HTML
  parser eats the first newline after a `<pre>`, so a string that begins with one
  lands the whole plate a row too high — on the roofline, where it looks like a
  bug rather than a print.
- `.plate` uses the **system** monospace stack, not the vendored IBM Plex Mono.
  The vendored faces are latin-subset, so Plex would hand every box-drawing glyph
  back to a fallback and the columns would stop lining up.

## The fonts

`public/fonts/` holds the same three woff2 files the app serves, for the reason
in `docs/decisions/0017`: a design language that needs fonts.googleapis.com to
look right is not a design language. They are copies, because this app deploys on
its own and shares no build step with the repository that produced them. Regenerate
them with `node scripts/vendor-fonts.mjs` from the root and copy them across.

## Deploying it

It is **not** part of the npm workspaces at the repository root. The site has
React and Next in it, which the daemon and the CLI have no business resolving.

That means the Vercel project must have its **Root Directory set to `website`**.
Without it Vercel builds from the repository root, finds no `next` in the
workspace `package.json`, and fails with `NEXT_NO_VERSION`.

The **Framework Preset must stay Next.js**. `/api/download` is a server route; if
the preset is cleared the page is published as static files and every download
button stops working.

Pushing to `main` deploys it. Nothing here needs building by hand.
