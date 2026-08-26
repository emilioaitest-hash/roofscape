import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { cap, type AgentContext } from './context.js'
import { execute } from './exec.js'
import type { MemoryLayer, MemoryScope } from '../domain/memory.js'
import type { FloorId } from '../domain/ids.js'

/**
 * The tools every agent has.
 *
 * They are identical whichever provider answers, so what a floor can do never
 * depends on which vendor was cheapest that week. Which of them a given floor is
 * handed is a separate question, decided by its role.
 */
export function buildToolSet(context: AgentContext, allowed: readonly string[]): ToolSet {
  const all = allTools(context)
  const chosen: ToolSet = {}
  for (const name of allowed) if (all[name]) chosen[name] = all[name]
  return chosen
}

export const TOOL_NAMES = [
  'read_file', 'write_file', 'edit_file', 'list_dir', 'search', 'shell',
  'recall', 'remember', 'ask_owner', 'assign_task', 'ask_colleague', 'finish',
] as const

/** A sensible tool row per role. A judge that can write is not a judge. */
export const TOOLS_FOR_ROLE: Record<string, readonly string[]> = {
  manager: ['read_file', 'list_dir', 'search', 'recall', 'remember', 'assign_task', 'ask_colleague', 'ask_owner', 'finish'],
  hiring: ['read_file', 'list_dir', 'recall', 'remember', 'ask_owner', 'finish'],
  // A reviewer holds nothing that writes — not even a shell, because a shell
  // can write a file. See docs/decisions/0010.
  reviewer: ['read_file', 'list_dir', 'search', 'recall', 'remember', 'finish'],
  coder: ['read_file', 'write_file', 'edit_file', 'list_dir', 'search', 'shell', 'recall', 'remember', 'ask_colleague', 'finish'],
  curator: ['recall', 'remember', 'finish'],
  researcher: ['read_file', 'list_dir', 'search', 'shell', 'recall', 'remember', 'finish'],
  writer: ['read_file', 'write_file', 'edit_file', 'list_dir', 'recall', 'remember', 'finish'],
  designer: ['read_file', 'write_file', 'edit_file', 'list_dir', 'recall', 'remember', 'finish'],
  marketer: ['read_file', 'write_file', 'list_dir', 'recall', 'remember', 'ask_owner', 'finish'],
  ops: ['read_file', 'list_dir', 'search', 'shell', 'recall', 'remember', 'ask_owner', 'finish'],
}

function allTools(context: AgentContext): ToolSet {
  const { workspace, store, floor } = context

  const guard = <T>(work: () => T): T | { error: string } => {
    try {
      return work()
    } catch (error) {
      return { error: (error as Error).message }
    }
  }

  return {
    read_file: tool({
      description: 'Read a file from the workspace. Use this before editing anything.',
      inputSchema: z.object({
        path: z.string().describe('Path relative to the workspace root.'),
        from_line: z.number().int().min(1).optional().describe('First line to read, 1-based.'),
        lines: z.number().int().min(1).max(2000).optional().describe('How many lines to read.'),
      }),
      execute: async ({ path, from_line, lines }) =>
        guard(() => {
          const absolute = workspace.resolve(path)
          if (!existsSync(absolute)) return { error: `No such file: ${path}` }
          const text = readFileSync(absolute, 'utf8')
          if (from_line === undefined && lines === undefined) return { content: cap(text) }
          const all = text.split('\n')
          const start = (from_line ?? 1) - 1
          const slice = all.slice(start, start + (lines ?? 200))
          return { content: cap(slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n')), of: all.length }
        }),
    }),

    write_file: tool({
      description: 'Write a whole file, creating it and any missing directories. Overwrites what is there.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) =>
        guard(() => {
          const absolute = workspace.resolve(path)
          mkdirSync(dirname(absolute), { recursive: true })
          writeFileSync(absolute, content)
          return { written: workspace.display(absolute), bytes: Buffer.byteLength(content) }
        }),
    }),

    edit_file: tool({
      description:
        'Replace an exact string in a file. The string must appear exactly once, so include enough surrounding context to be unambiguous.',
      inputSchema: z.object({
        path: z.string(),
        find: z.string().describe('The exact text to replace, including indentation.'),
        replace: z.string(),
      }),
      execute: async ({ path, find, replace }) =>
        guard(() => {
          const absolute = workspace.resolve(path)
          if (!existsSync(absolute)) return { error: `No such file: ${path}` }
          const text = readFileSync(absolute, 'utf8')
          const count = text.split(find).length - 1
          if (count === 0) return { error: 'That text does not appear in the file. Read it again.' }
          if (count > 1) return { error: `That text appears ${count} times. Include more context so it is unique.` }
          writeFileSync(absolute, text.replace(find, replace))
          return { edited: workspace.display(absolute) }
        }),
    }),

    list_dir: tool({
      description: 'List a directory in the workspace.',
      inputSchema: z.object({ path: z.string().default('.') }),
      execute: async ({ path }) =>
        guard(() => {
          const absolute = workspace.resolve(path)
          if (!existsSync(absolute)) return { error: `No such directory: ${path}` }
          const entries = readdirSync(absolute)
            .filter((name) => name !== '.git' && name !== 'node_modules')
            .slice(0, 300)
            .map((name) => {
              const info = statSync(join(absolute, name))
              return info.isDirectory() ? `${name}/` : `${name} (${info.size}b)`
            })
          return { entries }
        }),
    }),

    search: tool({
      description: 'Search the workspace for a pattern. Prefer this to reading many files.',
      inputSchema: z.object({
        pattern: z.string().describe('A regular expression.'),
        path: z.string().default('.'),
      }),
      execute: async ({ pattern, path }) => {
        const escaped = pattern.replaceAll("'", "'\\''")
        const where = path.replaceAll("'", "'\\''")
        const result = await execute(context, `rg -n --no-heading -m 200 -- '${escaped}' '${where}' || grep -rn -- '${escaped}' '${where}' || true`)
        return { matches: result.output }
      },
    }),

    shell: tool({
      description:
        'Run a shell command in the working directory. Ordinary development commands run straight away; anything unfamiliar is put to the owner first.',
      inputSchema: z.object({
        command: z.string(),
        timeout_seconds: z.number().int().min(1).max(900).default(120),
      }),
      execute: async ({ command, timeout_seconds }) => execute(context, command, { timeoutSeconds: timeout_seconds }),
    }),

    recall: tool({
      description:
        'Search your memory and the building handbook. Do this before assuming anything about how this building works — it is cheaper than being wrong.',
      inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(20).default(6) }),
      execute: async ({ query, limit }) => {
        const hits = store.recallByKeyword(query, { floor, limit })
        store.markRecalled(hits.map((h) => h.id))
        return {
          found: hits.length,
          memories: hits.map((h) => ({ id: h.id, layer: h.layer, text: h.text, source: h.source })),
        }
      },
    }),

    remember: tool({
      description:
        'Write something down for next time. Record what turned out to be true, not what you did — a log of actions is not worth recalling.',
      inputSchema: z.object({
        text: z.string().describe('One fact or one playbook step, stated plainly.'),
        layer: z.enum(['episodic', 'semantic', 'procedural']).default('semantic'),
        shared: z.boolean().default(false).describe('True to put it in the building handbook rather than your own notes.'),
      }),
      execute: async ({ text, layer, shared }) => {
        const record = store.remember({
          scope: (shared ? 'building' : 'floor') as MemoryScope,
          layer: layer as MemoryLayer,
          floor: shared ? null : floor,
          text,
          source: context.task ?? 'unprompted',
        })
        return { remembered: record.id, scope: record.scope }
      },
    }),

    ask_owner: tool({
      description:
        'Put something to the owner and wait. Required before anything that reaches outside the building: publishing, sending, deploying, spending, or merging to main.',
      inputSchema: z.object({
        kind: z.enum(['publish', 'send', 'deploy', 'spend', 'merge', 'hire']),
        intent: z.string().describe('What will happen if they say yes, in plain language.'),
      }),
      execute: async ({ kind, intent }) => ({ granted: await context.ask(kind, intent) }),
    }),

    assign_task: tool({
      description:
        'Hand a piece of work to a colleague. State how it will be judged: they cannot ask you what you meant once they have started.',
      inputSchema: z.object({
        to: z.string().describe('The floor id of the colleague, as given in your staff list.'),
        goal: z.string(),
        acceptance: z.array(z.string()).min(1).describe('How both of you will know it is done.'),
      }),
      execute: async ({ to, goal, acceptance }) =>
        guard(() => {
          const recipient = store.floor(to as FloorId)
          if (!recipient) return { error: `No floor ${to} in this building.` }
          if (recipient.vacatedAt) return { error: `${recipient.name} no longer works here.` }
          const task = store.assign({ by: floor, to: recipient.id, goal, acceptance })
          store.post({ kind: 'task', from: floor, to: recipient.id, body: goal })
          return { assigned: task.id, to: recipient.name }
        }),
    }),

    ask_colleague: tool({
      description: 'Ask a colleague a question. Use for something they know and you do not — not to delegate work.',
      inputSchema: z.object({ to: z.string(), question: z.string() }),
      execute: async ({ to, question }) =>
        guard(() => {
          const recipient = store.floor(to as FloorId)
          if (!recipient) return { error: `No floor ${to} in this building.` }
          const message = store.post({ kind: 'question', from: floor, to: recipient.id, body: question })
          return { asked: message.id, of: recipient.name, note: 'They will answer in their own time; do not wait on it.' }
        }),
    }),

    finish: tool({
      description:
        'Declare the work done and hand back the result. Call this exactly once, at the end. If you could not finish, say so here plainly rather than claiming otherwise.',
      inputSchema: z.object({
        summary: z.string().describe('What you did, in a few sentences.'),
        artifacts: z.array(z.string()).default([]).describe('Branches, paths or URLs produced.'),
        succeeded: z.boolean().default(true).describe('False if the goal was not met.'),
      }),
      execute: async ({ summary, artifacts, succeeded }) => ({ recorded: true, summary, artifacts, succeeded }),
    }),
  }
}
