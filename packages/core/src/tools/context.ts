import type { BuildingStore } from '../store/buildingStore.js'
import type { Building } from '../domain/building.js'
import type { FloorId, TaskId } from '../domain/ids.js'
import type { Workspace } from './workspace.js'

/** What an agent is allowed to ask a person about, mid-task. */
export type EscalationKind = 'shell' | 'publish' | 'send' | 'deploy' | 'spend' | 'merge' | 'hire'

/**
 * Everything a tool needs to know about who is calling it and on whose behalf.
 * Passed in rather than reached for, so a tool cannot quietly act as a floor
 * other than the one running it.
 */
export interface AgentContext {
  building: Building
  store: BuildingStore
  workspace: Workspace
  /** The floor running this turn. Tools act as this floor and no other. */
  floor: FloorId
  /** The task being worked, when there is one. */
  task: TaskId | null
  /**
   * Ask a person. Resolves true if granted. The default implementation records
   * an approval and refuses, so that an unattended run stops rather than
   * assuming yes.
   */
  ask(kind: EscalationKind, intent: string): Promise<boolean>
  /** Where the agent is working: usually a git worktree, not the checkout. */
  cwd: string
}

/** Tool output is charged for by the token, so it is capped and says so. */
export function cap(text: string, limit = 16_000): string {
  if (text.length <= limit) return text
  const head = text.slice(0, Math.floor(limit * 0.7))
  const tail = text.slice(-Math.floor(limit * 0.2))
  const dropped = text.length - head.length - tail.length
  return `${head}\n\n… ${dropped.toLocaleString()} characters omitted from the middle …\n\n${tail}`
}
