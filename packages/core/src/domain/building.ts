import type { BuildingId, FloorId } from './ids.js'

/**
 * A building is one company or project. It shares nothing with its neighbours,
 * which is what makes it the unit of backup, export, handover and templating.
 */
export interface Building {
  id: BuildingId
  /** Short name, as shown on the skyline. */
  name: string
  /** What this building is for. Written by the owner; read by every floor. */
  charter: string
  /** Absolute path to the workspace this building may touch, and nothing above it. */
  workspace: string
  /** Repositories this building works in. */
  repos: readonly string[]
  budget: Budget
  createdAt: string
  /** null while under construction; set when the owner mothballs it. */
  closedAt: string | null
}

/**
 * Every agent occupies a floor. The building's height is its headcount, which is
 * the point: a skyline shows where effort actually sits.
 */
export interface Floor {
  id: FloorId
  building: BuildingId
  /** Storey number. The manager always holds the top. */
  level: number
  role: FloorRole
  /** Display name for this member of staff. */
  name: string
  /** The system prompt that makes this agent itself. */
  charter: string
  /** Which model answers for this floor, and on which engine. */
  posting: Posting
  tools: readonly string[]
  hiredAt: string
  /** Set when the floor is vacated. Memory is archived, never deleted. */
  vacatedAt: string | null
}

export type FloorRole =
  | 'manager'       // top floor: owns the backlog
  | 'hiring'        // lobby: drafts new staff for approval
  | 'coder'
  | 'reviewer'
  | 'researcher'
  | 'writer'
  | 'designer'
  | 'marketer'
  | 'ops'
  | 'curator'       // archives: consolidates memory overnight

export interface Posting {
  provider: string
  model: string
  engine: 'direct' | 'claude-agent-sdk'
  /** Reasoning effort, where the provider exposes one. */
  effort?: 'low' | 'medium' | 'high'
}

export interface Budget {
  /** Hard ceiling in output tokens per calendar month. Null means unmetered. */
  monthlyTokens: number | null
  /** Ceiling for any single task, after which it escalates rather than spends. */
  perTaskTokens: number
}
