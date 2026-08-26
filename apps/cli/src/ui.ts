/**
 * How the CLI looks.
 *
 * Colour is switched off when output is not a terminal, so piping to a file or
 * into another command gives plain text rather than escape codes.
 */
export const colour = process.stdout.isTTY && process.env.NO_COLOR === undefined

const wrap = (code: string) => (text: string) => (colour ? `\x1b[${code}m${text}\x1b[0m` : text)

export const bold = wrap('1')
export const dim = wrap('38;5;244')
export const green = wrap('38;5;114')
export const amber = wrap('38;5;222')
export const red = wrap('38;5;203')
export const blue = wrap('38;5;110')

export const say = (text = '') => process.stdout.write(`${text}\n`)

export function heading(text: string): void {
  say()
  say(bold(text))
  say(dim('─'.repeat(Math.min(text.length, 60))))
}

/** A short line the owner can act on, rather than a stack trace. */
export function fail(message: string, remedy?: string): never {
  say()
  say(red(message))
  if (remedy) say(dim(remedy))
  say()
  process.exit(1)
}

export function tick(text: string): void {
  say(`${green('✓')} ${text}`)
}

export function note(text: string): void {
  say(dim(`  ${text}`))
}

export function table(rows: ReadonlyArray<readonly [string, string]>, gap = 2): void {
  const width = Math.max(0, ...rows.map(([left]) => left.length))
  for (const [left, right] of rows) {
    say(`  ${dim(left.padEnd(width))}${' '.repeat(gap)}${right}`)
  }
}

/** Relative time, because "3 minutes ago" is easier to judge than a timestamp. */
export function ago(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
}
