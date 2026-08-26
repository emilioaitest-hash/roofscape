/**
 * The product's name lives here and nowhere else.
 *
 * Internal package names use the neutral `@app/*` scope on purpose, so that
 * naming the product is this one file — not a rename across the tree.
 */
export const BRAND = {
  /** Display name, as written in prose and on screen. */
  name: 'Towerscape',
  /** Lowercase slug: binary name, config dir, package scope if ever published. */
  slug: 'towerscape',
  /** Data directory under the user's home. */
  homeDir: '.towerscape',
  /** Primary domain, once registered. */
  domain: 'towerscape.ai',
  /** One line, for --help output and the installer. */
  tagline: 'A skyline of your work. Every project a building; every hire a floor.',
} as const

export type Brand = typeof BRAND
