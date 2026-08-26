import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { definitionsByName } from './definitions.js'
import type { AgentContext } from './context.js'

/**
 * The same tools, in the shape the Claude Agent SDK wants.
 *
 * They are handed to Claude Code as an in-process MCP server, so a turn run on
 * a Claude subscription has exactly the tool row a turn run against a raw API
 * would have — same names, same descriptions, same bodies. The engine changes
 * what a turn costs and never what an agent can do.
 */
export function buildSdkMcpServer(context: AgentContext, allowed: readonly string[]) {
  const definitions = definitionsByName()
  const tools = allowed
    .map((name) => definitions.get(name))
    .filter((definition): definition is NonNullable<typeof definition> => definition !== undefined)
    .map((definition) =>
      sdkTool(definition.name, definition.description, definition.shape, async (input: unknown) => {
        const result = await definition.run(context, input as Record<string, unknown>)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }),
    )

  return createSdkMcpServer({ name: 'roofscape', version: '1.0.0', tools })
}

/** The names Claude Code uses for them, which are prefixed by the server name. */
export const qualifiedToolNames = (allowed: readonly string[]): string[] =>
  allowed.map((name) => `mcp__roofscape__${name}`)
