/**
 * Build the desktop app.
 *
 * Three bundles and a copy. Bundling rather than shipping node_modules is what
 * keeps packaging honest: the app carries no dependency tree to resolve at
 * runtime, so what runs on this machine is what runs on a stranger's.
 *
 * The daemon is bundled here too, and is the same daemon `roofscaped` runs. It
 * is built from source rather than copied from apps/daemon/dist so that a stale
 * dist cannot ship inside an app that looks freshly built.
 */
import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const dist = join(HERE, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

/**
 * Bundled CJS dependencies inside an ESM output can still ask for `require`,
 * `__dirname` or `__filename` at runtime. ESM has none of them, so they are
 * supplied.
 */
const esmShim = {
  js: [
    "import { createRequire as __makeRequire } from 'node:module'",
    "import { fileURLToPath as __toPath } from 'node:url'",
    "import { dirname as __dirOf } from 'node:path'",
    'const require = __makeRequire(import.meta.url)',
    'const __filename = __toPath(import.meta.url)',
    'const __dirname = __dirOf(__filename)',
  ].join('\n'),
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
}

// Electron supplies both of these itself; bundling them would ship a second,
// broken copy.
const provided = ['electron', 'electron-updater']

await build({
  ...common,
  entryPoints: [join(HERE, 'src', 'main.ts')],
  outfile: join(dist, 'main.cjs'),
  format: 'cjs',
  external: provided,
})

await build({
  ...common,
  entryPoints: [join(HERE, 'src', 'preload.ts')],
  outfile: join(dist, 'preload.cjs'),
  format: 'cjs',
  external: provided,
})

await build({
  ...common,
  entryPoints: [join(REPO, 'apps', 'daemon', 'src', 'main.ts')],
  outfile: join(dist, 'daemon.mjs'),
  format: 'esm',
  banner: esmShim,
  external: provided,
})

/**
 * The daemon serves the dashboard from `../public` relative to its own file, so
 * the page has to sit beside dist/ for the bundled copy exactly as it sits
 * beside apps/daemon/dist for the installed one. One page, two homes, no fork.
 */
await mkdir(join(HERE, 'public'), { recursive: true })
await cp(join(REPO, 'apps', 'daemon', 'public', 'index.html'), join(HERE, 'public', 'index.html'))

process.stdout.write('\nDesktop app built into apps/desktop/dist.\n')
