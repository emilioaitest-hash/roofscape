import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { definitionsByName } from './definitions.js'
import type { AgentContext } from './context.js'
import type { z } from 'zod'

/** A tool with its context already bound, so the engine need not know about one. */
export interface BoundTool {
  name: string
  description: string
  shape: Record<string, z.ZodTypeAny>
  run: (input: Record<string, unknown>) => Promise<unknown>
}

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
  return serverFor(
    allowed
      .map((name) => definitions.get(name))
      .filter((definition): definition is NonNullable<typeof definition> => definition !== undefined)
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        shape: definition.shape,
        run: (input: Record<string, unknown>) => definition.run(context, input),
      })),
  )
}

/**
 * The same, for tools that belong to nobody's building.
 *
 * The concierge is not a floor and has no AgentContext, but it should still be
 * able to run on a subscription — otherwise the one place that can see the whole
 * skyline is the one place that needs an API key.
 */
export function serverFor(tools: readonly BoundTool[]) {
  return createSdkMcpServer({
    name: 'roofscape',
    version: '1.0.0',
    tools: tools.map((t) =>
      sdkTool(t.name, t.description, t.shape, async (input: unknown) => {
        const result = await t.run(input as Record<string, unknown>)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }),
    ),
  })
}

/** The names Claude Code uses for them, which are prefixed by the server name. */
export const qualifiedToolNames = (allowed: readonly string[]): string[] =>
  allowed.map((name) => `mcp__roofscape__${name}`)
