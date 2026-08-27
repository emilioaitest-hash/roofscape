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
