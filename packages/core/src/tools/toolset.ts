import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { TOOL_DEFINITIONS, definitionsByName } from './definitions.js'
import type { AgentContext } from './context.js'

export { TOOL_DEFINITIONS, TOOL_NAMES, TOOLS_FOR_ROLE, WRITING_TOOLS, definitionsByName } from './definitions.js'
export type { ToolDefinition } from './definitions.js'

/**
 * The tools, in the shape the AI SDK wants. One of two adapters over the same
 * definitions — see `claudeAdapter.ts` for the other.
 */
export function buildToolSet(context: AgentContext, allowed: readonly string[]): ToolSet {
  const definitions = definitionsByName()
  const chosen: ToolSet = {}
  for (const name of allowed) {
    const definition = definitions.get(name)
    if (!definition) continue
    chosen[name] = tool({
      description: definition.description,
      inputSchema: z.object(definition.shape),
      execute: async (input: unknown) => definition.run(context, input as Record<string, unknown>),
    })
  }
  return chosen
}

/** Every tool, for tests and for listing what a role could hold. */
export const allToolNames = (): string[] => TOOL_DEFINITIONS.map((d) => d.name)
