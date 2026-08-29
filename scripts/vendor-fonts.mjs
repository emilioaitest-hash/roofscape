/**
 * Bring the typefaces into the repository.
 *
 * Roofscape runs on your machine, often with no network at all. A design
 * language that needs fonts.googleapis.com to look right is not a design
 * language, it is a hope — so the faces are fetched once, here, and served from
 * the app's own directory forever after.
 *
 *     node scripts/vendor-fonts.mjs
 *
 * Writes woff2 into apps/daemon/public/fonts/ and prints the @font-face block
 * to paste into app.css. Run it again only to change or add a face.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'apps', 'daemon', 'public', 'fonts')

/**
 * Google serves woff2 only to a user agent it believes can read it. Asking as a
 * current browser is the whole trick; asking as node gets you truetype.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Latin only. The app is English, and a full subset triples the weight. */
const FACES = [
  {
    file: 'fraunces.woff2',
    family: 'Fraunces',
    // opsz/SOFT/WONK are why this face was chosen: it is a serif that can be
    // asked to relax, which is where the playfulness lives.
    url: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..800,0..100,0..1&display=swap',
  },
  {
    file: 'instrument-sans.woff2',
    family: 'Instrument Sans',
    url: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap',
  },
  {
    file: 'plex-mono.woff2',
    family: 'IBM Plex Mono',
    url: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap',
  },
]

await mkdir(OUT, { recursive: true })

const written = []

for (const face of FACES) {
  const css = await (await fetch(face.url, { headers: { 'user-agent': UA } })).text()

  // Take the latin block: the last `src:` whose unicode-range covers basic latin.
  const blocks = css.split('@font-face').slice(1)
  const latin = blocks.find((b) => /unicode-range:[^;]*U\+0000-00FF/i.test(b)) ?? blocks[blocks.length - 1]
  const url = latin?.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1]

  if (!url) {
    process.stderr.write(`could not find a woff2 for ${face.family}\n`)
    continue
  }

  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  await writeFile(join(OUT, face.file), bytes)
  written.push({ ...face, bytes: bytes.length })
  process.stdout.write(`  ${face.family.padEnd(16)} ${(bytes.length / 1024).toFixed(0)} kB  →  fonts/${face.file}\n`)
}

process.stdout.write('\n/* paste into app.css */\n')
for (const face of written) {
  const variable = face.url.includes('..')
  process.stdout.write(
    `@font-face {\n` +
      `  font-family: '${face.family}';\n` +
      `  src: url('fonts/${face.file}') format('woff2');\n` +
      `  font-weight: ${variable ? '300 800' : '400 700'};\n` +
      `  font-style: normal;\n` +
      `  font-display: swap;\n}\n`,
  )
}
