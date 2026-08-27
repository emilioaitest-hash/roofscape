import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { cap, type AgentContext } from './context.js'
import { isProbablySecret, whyItIsBeingAsked } from './sensitive.js'
import { execute } from './exec.js'
import type { MemoryLayer, MemoryScope } from '../domain/memory.js'
import type { FloorId, MessageId, MemoryId as MemoryIdType } from '../domain/ids.js'
import type { Floor } from '../domain/building.js'

/**
 * The tools, defined once.
 *
 * A tool is a name, a description, a shape and a body — deliberately in no
 * vendor's format. The two engines adapt this list rather than each carrying
 * their own copy, which is what makes the promise in docs/decisions/0004 true
 * instead of merely intended: what a floor can do never depends on which engine
 * ran the turn.
 */
export interface ToolDefinition {
  name: string
  description: string
  /** A raw zod shape, because that is what both adapters can consume. */
  shape: Record<string, z.ZodTypeAny>
  run: (context: AgentContext, input: Record<string, unknown>) => Promise<unknown>
}

const guard = async (work: () => unknown | Promise<unknown>): Promise<unknown> => {
  try {
    return await work()
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace. Use this before editing anything.',
    shape: {
      path: z.string().describe('Path relative to the workspace root.'),
      from_line: z.number().int().min(1).optional().describe('First line to read, 1-based.'),
      lines: z.number().int().min(1).max(2000).optional().describe('How many lines to read.'),
    },
    run: async (context, input) => {
      const path = input.path as string
      // A repository's own .env sits inside the workspace, where reading is
      // allowed. Put it to the owner rather than quietly copying it into the
      // transcript and the archives.
      if (isProbablySecret(path)) {
        const granted = await context.ask('publish', whyItIsBeingAsked(path))
        if (!granted) {
          return { error: `Not read: ${path} looks like it holds secrets, and the owner did not agree to it being read.` }
        }
      }
      return guard(() => {
        const absolute = context.workspace.resolve(path)
        if (!existsSync(absolute)) return { error: `No such file: ${path}` }
        const text = readFileSync(absolute, 'utf8')
        const from = input.from_line as number | undefined
        const count = input.lines as number | undefined
        if (from === undefined && count === undefined) return { content: cap(text) }
        const all = text.split('\n')
        const start = (from ?? 1) - 1
        const slice = all.slice(start, start + (count ?? 200))
        return { content: cap(slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n')), of: all.length }
      })
    },
  },
  {
    name: 'write_file',
    description: 'Write a whole file, creating it and any missing directories. Overwrites what is there.',
    shape: { path: z.string(), content: z.string() },
    run: (context, input) =>
      guard(() => {
        const absolute = context.workspace.resolve(input.path as string)
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, input.content as string)
        return { written: context.workspace.display(absolute), bytes: Buffer.byteLength(input.content as string) }
      }),
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact string in a file. The string must appear exactly once, so include enough surrounding context to be unambiguous.',
    shape: {
      path: z.string(),
      find: z.string().describe('The exact text to replace, including indentation.'),
      replace: z.string(),
    },
    run: (context, input) =>
      guard(() => {
        const absolute = context.workspace.resolve(input.path as string)
        if (!existsSync(absolute)) return { error: `No such file: ${input.path}` }
        const text = readFileSync(absolute, 'utf8')
        const find = input.find as string
        const count = text.split(find).length - 1
        if (count === 0) return { error: 'That text does not appear in the file. Read it again.' }
        if (count > 1) return { error: `That text appears ${count} times. Include more context so it is unique.` }
        writeFileSync(absolute, text.replace(find, input.replace as string))
        return { edited: context.workspace.display(absolute) }
      }),
  },
  {
    name: 'list_dir',
    description: 'List a directory in the workspace.',
    shape: { path: z.string().default('.') },
    run: (context, input) =>
      guard(() => {
        const absolute = context.workspace.resolve((input.path as string) ?? '.')
        if (!existsSync(absolute)) return { error: `No such directory: ${input.path}` }
        const entries = readdirSync(absolute)
          .filter((name) => name !== '.git' && name !== 'node_modules')
          .slice(0, 300)
          .map((name) => {
            const info = statSync(join(absolute, name))
            return info.isDirectory() ? `${name}/` : `${name} (${info.size}b)`
          })
        return { entries }
      }),
  },
  {
    name: 'search',
    description: 'Search the workspace for a pattern. Prefer this to reading many files.',
    shape: {
      pattern: z.string().describe('A regular expression.'),
      path: z.string().default('.'),
    },
    run: async (context, input) => {
      const escaped = (input.pattern as string).replaceAll("'", "'\\''")
      const where = ((input.path as string) ?? '.').replaceAll("'", "'\\''")
      const result = await execute(
        context,
        `rg -n --no-heading -m 200 -- '${escaped}' '${where}' || grep -rn -- '${escaped}' '${where}' || true`,
      )
      return { matches: result.output }
    },
  },
  {
    name: 'shell',
    description:
      'Run a shell command in the working directory. Ordinary development commands run straight away; anything unfamiliar is put to the owner first.',
    shape: {
      command: z.string(),
      timeout_seconds: z.number().int().min(1).max(900).default(120),
    },
    run: (context, input) =>
      execute(context, input.command as string, { timeoutSeconds: (input.timeout_seconds as number) ?? 120 }),
  },
  {
    name: 'recall',
    description:
      'Search your memory and the building handbook. Do this before assuming anything about how this building works — it is cheaper than being wrong.',
    shape: { query: z.string(), limit: z.number().int().min(1).max(20).default(6) },
    run: async (context, input) => {
      const hits = context.store.recallByKeyword(input.query as string, {
        floor: context.floor,
        limit: (input.limit as number) ?? 6,
      })
      context.store.markRecalled(hits.map((h) => h.id))
      return {
        found: hits.length,
        memories: hits.map((h) => ({ id: h.id, layer: h.layer, text: h.text, source: h.source })),
      }
    },
  },
  {
    name: 'remember',
    description:
      'Write something down for next time. Record what turned out to be true, not what you did — a log of actions is not worth recalling.',
    shape: {
      text: z.string().describe('One fact or one playbook step, stated plainly.'),
      layer: z.enum(['episodic', 'semantic', 'procedural']).default('semantic'),
      shared: z.boolean().default(false).describe('True to put it in the building handbook rather than your own notes.'),
    },
    run: async (context, input) => {
      const shared = Boolean(input.shared)
      const record = context.store.remember({
        scope: (shared ? 'building' : 'floor') as MemoryScope,
        layer: ((input.layer as string) ?? 'semantic') as MemoryLayer,
        floor: shared ? null : context.floor,
        text: input.text as string,
        source: context.task ?? 'unprompted',
      })
      return { remembered: record.id, scope: record.scope }
    },
  },
  {
    name: 'ask_owner',
    description:
      'Put something to the owner and wait. Required before anything that reaches outside the building: publishing, sending, deploying, spending, or merging to main.',
    shape: {
      kind: z.enum(['publish', 'send', 'deploy', 'spend', 'merge', 'hire']),
      intent: z.string().describe('What will happen if they say yes, in plain language.'),
    },
    run: async (context, input) => ({
      granted: await context.ask(input.kind as 'publish', input.intent as string),
    }),
  },
  {
    name: 'assign_task',
    description:
      'Hand a piece of work to a colleague. State how it will be judged: they cannot ask you what you meant once they have started.',
    shape: {
      to: z.string().describe('The floor id of the colleague, as given in your staff list.'),
      goal: z.string(),
      acceptance: z.array(z.string()).min(1).describe('How both of you will know it is done.'),
    },
    run: (context, input) =>
      guard(() => {
        const recipient = context.store.floor(input.to as FloorId)
        if (!recipient) return { error: `No floor ${input.to} in this building.` }
        if (recipient.vacatedAt) return { error: `${recipient.name} no longer works here.` }
        const task = context.store.assign({
          by: context.floor,
          to: recipient.id,
          goal: input.goal as string,
          acceptance: input.acceptance as string[],
        })
        context.store.post({ kind: 'task', from: context.floor, to: recipient.id, body: input.goal as string })
        return { assigned: task.id, to: recipient.name }
      }),
  },
  {
    name: 'ask_colleague',
    description: 'Ask a colleague a question. Use for something they know and you do not — not to delegate work.',
    shape: { to: z.string(), question: z.string() },
    run: (context, input) =>
      guard(() => {
        const recipient = context.store.floor(input.to as FloorId)
        if (!recipient) return { error: `No floor ${input.to} in this building.` }
        const message = context.store.post({
          kind: 'question',
          from: context.floor,
          to: recipient.id,
          body: input.question as string,
        })
        return {
          asked: message.id,
          of: recipient.name,
          note: 'It is in their inbox. They will see it the next time they are set to work; do not wait on it.',
        }
      }),
  },
  {
    name: 'check_mail',
    description:
      'Read the post addressed to you. Oldest first, and only what you ask for — what you read is marked read, and anything left over stays in the inbox for next time.',
    shape: {
      // Bounded on purpose. An inbox is unbounded and a turn's context is not:
      // a floor that has been away for a week should not spend its whole budget
      // reading its own post before it starts.
      limit: z.number().int().min(1).max(25).default(10),
    },
    run: (context, input) =>
      guard(() => {
        const waiting = context.store.inbox(context.floor)
        const take = (input.limit as number) ?? 10
        const unread = waiting.slice(0, take)
        const staff = new Map(context.store.staff({ includeVacated: true }).map((f) => [f.id as string, f.name]))
        for (const message of unread) context.store.markRead(message.id)
        const left = waiting.length - unread.length
        return {
          post: unread.map((message) => ({
            id: message.id,
            from: message.from === null ? 'the owner' : (staff.get(message.from) ?? 'somebody who has left'),
            fromId: message.from,
            kind: message.kind,
            body: message.body,
            at: message.createdAt,
          })),
          ...(left > 0 ? { stillWaiting: left } : {}),
          ...(waiting.length === 0 ? { note: 'Nothing new.' } : {}),
        }
      }),
  },
  {
    name: 'reply',
    description:
      'Answer a message you were sent, or tell the owner something. Keep it to what the other person actually needs — this is post, not conversation, and every round of it is paid for.',
    shape: {
      to: z.string().describe('A floor id, or "owner" for the person who owns the building.'),
      body: z.string().max(2000),
      in_reply_to: z.string().optional().describe('The id of the message you are answering, if you are answering one.'),
      kind: z.enum(['answer', 'status', 'note', 'escalation']).default('answer'),
    },
    run: (context, input) =>
      guard(() => {
        const target = String(input.to)
        // The owner is not a floor, so they are addressed by name and stored as
        // null. See the Correspondent type.
        const toOwner = target === 'owner' || target === 'the owner'
        const recipient = toOwner ? null : context.store.floor(target as FloorId)
        if (!toOwner && !recipient) return { error: `No floor ${target} in this building, and "owner" was not asked for.` }
        const message = context.store.post({
          kind: input.kind as 'answer',
          from: context.floor,
          to: toOwner ? null : (recipient as Floor).id,
          body: input.body as string,
          ...(input.in_reply_to ? { inReplyTo: input.in_reply_to as MessageId } : {}),
        })
        return { sent: message.id, to: toOwner ? 'the owner' : (recipient as Floor).name }
      }),
  },
  {
    name: 'list_memory',
    description:
      'Read a batch of notes from the archives in the order they were written. Use this to consolidate, not to answer a question — for that, use recall.',
    shape: {
      layer: z.enum(['working', 'episodic', 'semantic', 'procedural']).optional(),
      limit: z.number().int().min(1).max(100).default(40),
    },
    run: async (context, input) => {
      const records = context.store.browse({
        ...(input.layer ? { layer: input.layer as 'episodic' } : {}),
        limit: (input.limit as number) ?? 40,
      })
      return {
        count: records.length,
        notes: records.map((r) => ({
          id: r.id,
          layer: r.layer,
          scope: r.scope,
          text: r.text,
          recalled: r.useCount,
          written: r.createdAt.slice(0, 10),
          pinned: r.pinned,
        })),
      }
    },
  },
  {
    name: 'forget',
    description:
      'Delete a note. Use it for duplicates you have merged and for notes about work nobody does any more. Say why — it is recorded.',
    shape: { id: z.string(), why: z.string().describe('Why this note is not worth keeping.') },
    run: (context, input) =>
      guard(() => {
        context.store.forget(input.id as MemoryIdType)
        return { forgotten: input.id, why: input.why }
      }),
  },
  {
    name: 'pin',
    description:
      'Pin a note so every turn carries it without having to search. Reserve this for what would be a disaster to miss: pinned notes are paid for on every single turn, forever.',
    shape: { id: z.string(), pinned: z.boolean().default(true) },
    run: (context, input) =>
      guard(() => {
        context.store.setPinned(input.id as MemoryIdType, input.pinned !== false)
        return { id: input.id, pinned: input.pinned !== false }
      }),
  },
  {
    name: 'expire',
    description:
      'Mark a note as no longer true, without deleting it. Prefer this to forgetting when something was true once and the history matters.',
    shape: { id: z.string(), superseded_by: z.string().optional() },
    run: (context, input) =>
      guard(() => {
        context.store.expire(input.id as MemoryIdType)
        return { expired: input.id, supersededBy: input.superseded_by ?? null }
      }),
  },
  {
    name: 'propose_hire',
    description:
      'Propose taking on a new member of staff. It goes to the owner, and the floor is only filled if they agree. Make the case in three sentences: what work keeps arriving, why nobody here can take it, and what changes once the floor is filled.',
    shape: {
      role: z.enum([
        'manager', 'hiring', 'coder', 'reviewer', 'researcher',
        'writer', 'designer', 'marketer', 'ops', 'curator',
      ]),
      name: z.string().describe('A short human name for them.'),
      why: z.string().describe('The case for the hire, in three sentences.'),
      charter: z.string().optional().describe('Their instructions. Leave empty to use the standard ones for the role.'),
    },
    run: async (context, input) => {
      const role = input.role as string
      const approval = context.store.requestApproval({
        kind: 'hire',
        by: context.floor,
        intent: `Hire ${input.name} as ${role}. ${input.why}`,
        payload: {
          do: 'hire',
          role,
          name: input.name as string,
          charter: (input.charter as string | undefined) ?? '',
        },
      })
      return {
        proposed: approval.id,
        note: 'The owner decides. Nothing is filled until they do, so do not plan around it.',
      }
    },
  },
  {
    name: 'finish',
    description:
      'Declare the work done and hand back the result. Call this exactly once, at the end. If you could not finish, say so plainly here rather than claiming otherwise.',
    shape: {
      summary: z.string().describe('What you did, in a few sentences.'),
      artifacts: z.array(z.string()).default([]).describe('Branches, paths or URLs produced.'),
      succeeded: z.boolean().default(true).describe('False if the goal was not met.'),
    },
    run: async (_context, input) => ({
      recorded: true,
      summary: input.summary as string,
      artifacts: (input.artifacts as string[]) ?? [],
      succeeded: input.succeeded !== false,
    }),
  },
]

export const definitionsByName = (): Map<string, ToolDefinition> =>
  new Map(TOOL_DEFINITIONS.map((d) => [d.name, d]))

export const TOOL_NAMES = TOOL_DEFINITIONS.map((d) => d.name)

/** A sensible tool row per role. A judge that can write is not a judge. */
export const TOOLS_FOR_ROLE: Record<string, readonly string[]> = {
  manager: ['read_file', 'list_dir', 'search', 'recall', 'remember', 'assign_task', 'ask_colleague', 'check_mail', 'reply', 'ask_owner', 'finish'],
  // The manager may ask for a hire too, but the case is the hiring manager's to
  // make; this is here so a building with no hiring floor is not stuck.
  hiring: ['read_file', 'list_dir', 'recall', 'remember', 'propose_hire', 'check_mail', 'reply', 'ask_owner', 'finish'],
  // A reviewer holds nothing that writes — not even a shell, because a shell
  // can write a file. See docs/decisions/0010. Post is not writing: it changes
  // nothing outside the mailroom, and a reviewer that cannot say why it
  // rejected something is a reviewer nobody can argue with.
  reviewer: ['read_file', 'list_dir', 'search', 'recall', 'remember', 'check_mail', 'reply', 'finish'],
  coder: ['read_file', 'write_file', 'edit_file', 'list_dir', 'search', 'shell', 'recall', 'remember', 'ask_colleague', 'check_mail', 'reply', 'finish'],
  curator: ['list_memory', 'recall', 'remember', 'forget', 'pin', 'expire', 'finish'],
  researcher: ['read_file', 'list_dir', 'search', 'shell', 'recall', 'remember', 'check_mail', 'reply', 'finish'],
  writer: ['read_file', 'write_file', 'edit_file', 'list_dir', 'recall', 'remember', 'check_mail', 'reply', 'finish'],
  designer: ['read_file', 'write_file', 'edit_file', 'list_dir', 'recall', 'remember', 'check_mail', 'reply', 'finish'],
  marketer: ['read_file', 'write_file', 'list_dir', 'recall', 'remember', 'check_mail', 'reply', 'ask_owner', 'finish'],
  ops: ['read_file', 'list_dir', 'search', 'shell', 'recall', 'remember', 'check_mail', 'reply', 'ask_owner', 'finish'],
}

/** Tools that can change something. Used to assert a judge holds none of them. */
export const WRITING_TOOLS = new Set(['write_file', 'edit_file', 'shell'])
