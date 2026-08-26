/**
 * The product's name lives here and nowhere else.
 *
 * Internal package names use the neutral `@app/*` scope on purpose, so that
 * naming the product is this one file — not a rename across the tree.
 */
export const BRAND = {
  /** Display name, as written in prose and on screen. */
  name: 'Roofscape',
  /** Lowercase slug: binary name, config dir, package scope if ever published. */
  slug: 'roofscape',
  /** Data directory under the user's home. */
  homeDir: '.roofscape',
  /** Primary domain, once registered. */
  domain: 'roofscape.ai',
  /** One line, for --help output and the installer. */
  tagline: 'Every project a building. Every hire a floor.',
} as const

export type Brand = typeof BRAND
