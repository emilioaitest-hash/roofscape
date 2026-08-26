import { randomBytes } from 'node:crypto'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no l/o/0/1: these get read aloud

/**
 * Short, prefixed, readable ids. They appear in the CLI and in logs, so
 * `tsk_7fq2m` beats a UUID for anything a person has to type or compare.
 */
export function newId(prefix: string, length = 6): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return `${prefix}_${out}`
}

/** A building's id is its folder name, so it has to be legible and safe. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug.length > 0 ? slug : newId('building', 5)
}
