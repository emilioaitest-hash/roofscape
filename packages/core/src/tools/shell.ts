/**
 * What an agent may run, and what has to be asked about first.
 *
 * This is a filter, not a sandbox. It stops an agent wandering off by accident;
 * it does not stop one that is determined, because a shell is a programming
 * language and no allowlist survives contact with `sh -c`. The real boundary is
 * a container per building, which is why nothing here is offered as sufficient
 * for running someone else's agents. See docs/decisions/0006.
 */

/** Safe to run without asking, because none of them reach outside the workspace. */
export const ALLOWED = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'find', 'tree',
  'grep', 'rg', 'sed', 'awk', 'cut', 'sort', 'uniq', 'diff', 'basename', 'dirname',
  'echo', 'printf', 'pwd', 'true', 'false', 'test', 'date',
  'git', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'tsc', 'deno', 'bun',
  'python3', 'python', 'pip', 'pip3', 'pytest', 'ruff', 'mypy',
  'make', 'cargo', 'go', 'swift', 'javac', 'java', 'mvn', 'gradle',
  'jq', 'yq', 'tar', 'unzip', 'gzip', 'md5sum', 'shasum', 'sqlite3',
])

/** Never, whatever else is true. These are not worth an approval prompt. */
const FORBIDDEN = new Set(['sudo', 'su', 'doas', 'shutdown', 'reboot', 'halt', 'mkfs', 'fdisk', 'diskutil', 'dd'])

/** Patterns that mean the command is not doing what it appears to be doing. */
const DANGEROUS: ReadonlyArray<[RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*\s+)*(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/, 'a recursive forced delete'],
  [/(^|[^\w])\/(\s|$)/, 'an operation on the filesystem root'],
  [/\bcurl\b[^|]*\|\s*(ba)?sh\b/, 'piping a download straight into a shell'],
  [/\bwget\b[^|]*\|\s*(ba)?sh\b/, 'piping a download straight into a shell'],
  [/>\s*\/dev\/(sd|disk|nvme)/, 'writing to a raw device'],
  [/\bchmod\s+(-R\s+)?(777|a\+rwx)\b/, 'making files world-writable'],
  [/:\(\)\s*\{.*\|.*&.*\}/, 'a fork bomb'],
  [/\bgit\s+push\b.*\s(-f|--force)\b/, 'a force push'],
  [/\bgit\s+push\b.*\bmain\b/, 'a push to main'],
  [/\bhistory\b|\bHISTFILE\b/, 'tampering with shell history'],
]

export type Verdict =
  | { allow: true }
  | { allow: false; reason: string; escalate: boolean }

/**
 * Judge one command line. `escalate: true` means a person could reasonably say
 * yes; `escalate: false` means it is refused outright.
 */
export function judge(command: string): Verdict {
  const trimmed = command.trim()
  if (trimmed === '') return { allow: false, reason: 'Empty command.', escalate: false }

  for (const [pattern, description] of DANGEROUS) {
    if (pattern.test(trimmed)) {
      return { allow: false, reason: `Refused: this looks like ${description}.`, escalate: false }
    }
  }

  for (const segment of segments(trimmed)) {
    const head = firstWord(segment)
    if (head === '') continue
    if (FORBIDDEN.has(head)) {
      return { allow: false, reason: `Refused: \`${head}\` is never run by an agent.`, escalate: false }
    }
    if (!ALLOWED.has(head)) {
      return {
        allow: false,
        reason: `\`${head}\` is not on the list of commands agents may run unattended.`,
        escalate: true,
      }
    }
  }
  return { allow: true }
}

/** Split on the operators that start a new command, so each head is checked. */
const segments = (command: string): string[] =>
  command.split(/(?:\|\||&&|[;|&])/).map((s) => s.trim()).filter(Boolean)

/** The command being run, past any leading `VAR=value` assignments. */
function firstWord(segment: string): string {
  const words = segment.split(/\s+/).filter(Boolean)
  for (const word of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue
    if (word.startsWith('(') || word.startsWith('$')) return word.replace(/^[($]+/, '')
    return word.replace(/^.*\//, '')
  }
  return ''
}
