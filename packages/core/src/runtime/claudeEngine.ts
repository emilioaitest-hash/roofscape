import { query } from '@anthropic-ai/claude-agent-sdk'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildSdkMcpServer, qualifiedToolNames } from '../tools/claudeAdapter.js'
import type { AgentContext } from '../tools/context.js'

export interface ClaudeTurnRequest {
  context: AgentContext
  system: string
  prompt: string
  allowedTools: readonly string[]
  model?: string
  maxTurns: number
  timeoutSeconds: number
  onTool?: (name: string) => void
}

export interface ClaudeTurnResult {
  text: string
  inputTokens: number
  outputTokens: number
  turns: number
  error: string | null
  /** What `finish` reported, if the agent called it. */
  finished: { summary: string; artifacts: string[]; succeeded: boolean } | null
}

/**
 * Run a turn through the Claude Code the owner already has installed.
 *
 * The point is the subscription: a Claude plan carries limits that metered
 * billing does not, and someone paying for one should be able to spend it here.
 * Roofscape holds no credential of its own for this — it starts the CLI, and the
 * CLI is logged in or it is not.
 *
 * Built-in tools are switched off and ours are supplied as an in-process MCP
 * server, so the tool row is exactly the one the direct engine would give.
 */
export async function runClaudeTurn(request: ClaudeTurnRequest): Promise<ClaudeTurnResult> {
  const binary = claudeExecutable()
  if (!binary) {
    return {
      text: '',
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      finished: null,
      error:
        'Claude Code is not installed, or not on the PATH. Install it, or set ROOFSCAPE_CLAUDE_BIN to its location — or post this floor to a provider with an API key instead.',
    }
  }

  const server = buildSdkMcpServer(request.context, request.allowedTools)
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), request.timeoutSeconds * 1000)

  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let error: string | null = null
  let finished: ClaudeTurnResult['finished'] = null

  try {
    const response = query({
      prompt: request.prompt,
      options: {
        systemPrompt: request.system,
        mcpServers: { roofscape: server },
        allowedTools: qualifiedToolNames(request.allowedTools),
        // Ours and no others, so the two engines cannot drift apart.
        tools: [],
        maxTurns: request.maxTurns,
        permissionMode: 'bypassPermissions',
        pathToClaudeCodeExecutable: binary,
        cwd: request.context.cwd,
        abortController: abort,
        ...(request.model ? { model: request.model } : {}),
      },
    })

    for await (const message of response) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') text += block.text
          if (block.type === 'tool_use') {
            const name = block.name.replace('mcp__roofscape__', '')
            request.onTool?.(name)
            if (name === 'finish') {
              const input = block.input as { summary?: string; artifacts?: string[]; succeeded?: boolean }
              finished = {
                summary: input.summary ?? '',
                artifacts: input.artifacts ?? [],
                succeeded: input.succeeded !== false,
              }
            }
          }
        }
      }
      if (message.type === 'result') {
        turns = message.num_turns ?? 0
        inputTokens = message.usage?.input_tokens ?? 0
        outputTokens = message.usage?.output_tokens ?? 0
        if (message.is_error) {
          error = message.subtype === 'success' ? 'Claude Code reported an error.' : `Claude Code stopped: ${message.subtype}`
        }
      }
    }
  } catch (cause) {
    const message = (cause as Error).message
    error = abort.signal.aborted
      ? `Stopped: no answer within ${request.timeoutSeconds}s.`
      : /not logged in/i.test(message)
        ? 'Claude Code is installed but not logged in. Run `claude` once and sign in, then try again.'
        : message
  } finally {
    clearTimeout(deadline)
  }

  return { text, inputTokens, outputTokens, turns, error, finished }
}

/**
 * The Claude Code the owner installed — not the one bundled inside the SDK.
 *
 * This distinction is the whole thing: the SDK ships its own binary, which has
 * no credentials, and using it fails with "Not logged in" however well signed in
 * the real CLI is. Found the hard way.
 */
export function claudeExecutable(): string | null {
  const configured = process.env.ROOFSCAPE_CLAUDE_BIN
  if (configured && existsSync(configured)) return configured

  try {
    const found = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
    if (found && existsSync(found)) return found
  } catch {
    // `which` says nothing useful when it fails; fall through to the usual places.
  }

  for (const candidate of [
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
