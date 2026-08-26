import type { ModelMessage } from 'ai'

export interface CompressionOptions {
  /** Rough character budget for the whole conversation before trimming starts. */
  budget?: number
  /** Recent messages left completely alone. */
  keepRecent?: number
  /** Longest a trimmed tool result may be. */
  keepPerResult?: number
}

export interface CompressionReport {
  messages: ModelMessage[]
  /** Characters removed. Zero when nothing needed doing. */
  saved: number
  trimmed: number
}

/**
 * Working memory: keeping one task's own conversation from growing without end.
 *
 * The archives keep the *cost of a turn* flat as history grows. They do nothing
 * for the inside of a single task, where every step carries every earlier step's
 * output — so a forty-step task pays for all forty on the last one, and the
 * output of a `search` from twenty minutes ago is charged for again and again.
 *
 * Older tool results are shortened rather than removed. Removing them would be
 * cheaper still and would also break the conversation: a tool call with no
 * result is a malformed exchange that providers reject. The call stays, its
 * answer is summarised, and the shape survives.
 */
export function compressWorkingMemory(
  messages: readonly ModelMessage[],
  options: CompressionOptions = {},
): CompressionReport {
  const budget = options.budget ?? 60_000
  const keepRecent = options.keepRecent ?? 6
  const keepPerResult = options.keepPerResult ?? 240

  const before = sizeOf(messages)
  if (before <= budget) return { messages: [...messages], saved: 0, trimmed: 0 }

  // The first message is the task itself and is never touched: an agent that
  // forgets what it was asked will confidently do the wrong thing.
  const untouchableUntil = 1
  const recentFrom = Math.max(untouchableUntil, messages.length - keepRecent)

  let trimmed = 0
  const out = messages.map((message, index) => {
    if (index < untouchableUntil || index >= recentFrom) return message
    if (message.role !== 'tool') return message

    const parts = Array.isArray(message.content) ? message.content : []
    let changedHere = false
    const content = parts.map((part) => {
      if (part.type !== 'tool-result') return part
      const shortened = shorten(part.output, keepPerResult)
      if (!shortened) return part
      changedHere = true
      return { ...part, output: shortened }
    })

    if (!changedHere) return message
    trimmed += 1
    return { ...message, content } as ModelMessage
  })

  return { messages: out, saved: before - sizeOf(out), trimmed }
}

type Output = Extract<
  Extract<ModelMessage, { role: 'tool' }>['content'][number],
  { type: 'tool-result' }
>['output']

/** Shorten a tool result in place, or return null if it is already short. */
function shorten(output: Output, limit: number): Output | null {
  const text = renderOutput(output)
  if (text === null || text.length <= limit) return null
  const head = text.slice(0, limit)
  return {
    type: 'text',
    value: `${head}\n…(${(text.length - limit).toLocaleString()} characters from earlier in this task, dropped to keep the conversation affordable. Run the tool again if you need them.)`,
  }
}

function renderOutput(output: Output): string | null {
  if (output.type === 'text' || output.type === 'error-text') return output.value
  if (output.type === 'json' || output.type === 'error-json') return JSON.stringify(output.value)
  return null
}

/** Rough size. Characters, not tokens: the ratio is stable enough to budget by. */
export function sizeOf(messages: readonly ModelMessage[]): number {
  let total = 0
  for (const message of messages) {
    if (typeof message.content === 'string') total += message.content.length
    else if (Array.isArray(message.content)) total += JSON.stringify(message.content).length
  }
  return total
}
