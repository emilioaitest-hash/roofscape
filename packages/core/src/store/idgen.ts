import { randomBytes } from 'node:crypto'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no l/o/0/1: these get read aloud

/**
 * Short, prefixed, readable ids. They appear in the CLI and in logs, so
 * `tsk_7fq2mkx4bwqd` beats a UUID for anything a person has to compare — and
 * commands match on a prefix, so nobody types the whole thing.
 *
 * Twelve characters, not six. Six gave thirty bits, and the birthday bound at
 * ten thousand records is about one collision in twenty runs — which is how CI
 * found this, inserting ten thousand memories and losing a write. A building
 * that has been used for a year holds far more than ten thousand.
 *
 * Twelve gives sixty bits: about one chance in two million at a million records.
 * The alphabet has thirty-two letters and a byte has two hundred and fifty-six
 * values, so the modulo is exactly even and no letter is favoured.
 */
export function newId(prefix: string, length = 12): string {
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
