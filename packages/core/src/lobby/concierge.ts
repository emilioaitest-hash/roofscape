import { generateText, stepCountIs, tool, type LanguageModel, type ToolSet } from 'ai'
import { z } from 'zod'
import { lobbyTools, type LobbyDeps } from './tools.js'
import { resolveLanguageModel, type Credentials } from '../providers/resolve.js'
import { defaultPosting, discoverProviders } from '../providers/roles.js'
import { runClaudeTurn } from '../runtime/claudeEngine.js'
import { classifyFailure } from '../providers/failure.js'
import { compressWorkingMemory } from '../runtime/working.js'
import type { Posting } from '../domain/building.js'

export interface AskRequest extends LobbyDeps {
  question: string
  credentials: Credentials
  owner: { name: string; profile: string }
  /** Overrides the model. Tests pass one; nothing else needs to. */
  resolveModel?: (posting: Posting) => LanguageModel
  onTool?: (name: string) => void
}

export interface AskResult {
  answer: string
  tokensSpent: number
  toolsUsed: string[]
}

const CHARTER = `You are the concierge in the lobby. You know the whole skyline: every
building, who works there, what is in hand, and what each one remembers.

You are asked things by the owner, and there are two kinds of question.

Most are about what is going on. Answer them: look at the buildings, read what
they remember, and say what is true. Be specific — name the building, name the
person, quote the thing. "Some progress was made" is not an answer.

A few are requests for work. Those you hand to a building, to be done by the
people who work there. Hand it to the building whose job it is, phrased the way
you would say it to the manager: they cannot come back and ask what you meant.
Do not hand work over to satisfy your own curiosity, and do not hand it over
when the owner was only asking a question.

You cannot change anything yourself. No files, no commands, no hiring. That is
on purpose: you can see everything, so you should be able to alter very little.

If you do not know, say so and say what you looked at. Finish by calling
\`answer\` exactly once.`

/**
 * Ask the building across the road.
 *
 * The Lobby was reserved in the architecture from the start and left unbuilt.
 * It is where somebody stands who can see the whole skyline — which is the one
 * view nobody inside a building has, because buildings deliberately share
 * nothing.
 */
export async function ask(request: AskRequest): Promise<AskResult> {
  // discoverProviders, not availableProviders: an installed Claude Code is a way
  // to reach Anthropic that needs no key, and on a machine where that is the only
  // provider the concierge could not run at all. The one place that can see the
  // whole skyline should not be the one place that needs an API key.
  const available = await discoverProviders(request.credentials)
  const posting =
    defaultPosting('manager', available) ??
    ({ provider: 'anthropic', model: 'claude-opus-4-5', engine: 'direct' } as Posting)

  const definitions = lobbyTools({ startGoal: request.startGoal })
  const tools: ToolSet = {}
  for (const definition of definitions) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: z.object(definition.shape),
      execute: async (input: unknown) => {
        request.onTool?.(definition.name)
        return definition.run(input as Record<string, unknown>)
      },
    })
  }

  const build = request.resolveModel ?? ((p: Posting) => resolveLanguageModel(p, request.credentials))
  const used: string[] = []

  // The same two engines the floors have. A test that injects a model always
  // takes the direct path, because that is the one a mock can stand in for.
  if (posting.engine === 'claude-agent-sdk' && !request.resolveModel) {
    // The engine watches for a tool called `finish`; the concierge's is called
    // `answer`, so its text is caught here rather than left to be recovered
    // from whatever prose happened to come out.
    let answered: string | null = null

    const turn = await runClaudeTurn({
      context: { cwd: process.cwd() },
      boundTools: definitions.map((d) => ({
        name: d.name,
        description: d.description,
        shape: d.shape,
        run: async (input: Record<string, unknown>) => {
          used.push(d.name)
          request.onTool?.(d.name)
          if (d.name === 'answer') answered = String(input.text ?? '').trim()
          return d.run(input)
        },
      })),
      system: CHARTER,
      prompt: request.question,
      allowedTools: definitions.map((d) => d.name),
      maxTurns: 12,
      timeoutSeconds: 180,
      ...(posting.model ? { model: posting.model } : {}),
    })

    return {
      answer: answered ?? (answerFromText(turn.text) || turn.error || 'I could not work that out.'),
      tokensSpent: turn.outputTokens,
      toolsUsed: used,
    }
  }

  try {
    const result = await generateText({
      model: build(posting),
      system: [
        CHARTER,
        '',
        request.owner.name ? `You are talking to ${request.owner.name}.` : '',
        request.owner.profile ? request.owner.profile : '',
      ].filter(Boolean).join('\n'),
      messages: [{ role: 'user', content: request.question }],
      tools,
      maxOutputTokens: 4000,
      abortSignal: AbortSignal.timeout(180_000),
      prepareStep: ({ messages }) => {
        const compressed = compressWorkingMemory(messages, { budget: 40_000 })
        return compressed.saved > 0 ? { messages: compressed.messages } : {}
      },
      stopWhen: [stepCountIs(12), ({ steps }) => answerFrom(steps) !== null],
      onStepFinish: (step) => {
        for (const call of step.toolCalls ?? []) used.push(call.toolName)
      },
    })

    return {
      answer: answerFrom(result.steps) ?? result.text.trim() ?? 'I could not work that out.',
      tokensSpent: result.totalUsage?.outputTokens ?? 0,
      toolsUsed: used,
    }
  } catch (error) {
    const failure = classifyFailure(error)
    return {
      answer: `I could not answer: ${failure.message}${failure.remedy ? `\n${failure.remedy}` : ''}`,
      tokensSpent: 0,
      toolsUsed: used,
    }
  }
}

/** The Claude engine hands back prose; `answer` is a tool it may simply not call. */
const answerFromText = (text: string): string => text.trim()

function answerFrom(steps: readonly { toolCalls?: readonly { toolName: string; input: unknown }[] }[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    for (const call of steps[i]!.toolCalls ?? []) {
      if (call.toolName === 'answer') return ((call.input as { text?: string }).text ?? '').trim()
    }
  }
  return null
}
