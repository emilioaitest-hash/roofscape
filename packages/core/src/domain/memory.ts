import type { BuildingId, FloorId, MemoryId } from './ids.js'

/**
 * Memory is never pasted into a prompt wholesale. A turn carries a small fixed
 * core; everything else is fetched by `recall`. That is what keeps cost per turn
 * flat as the archive grows.
 *
 * Recall is keyword-based and always works. Meaning-based search is optional and
 * ranks alongside it rather than replacing it — see docs/decisions/0011.
 */
export interface MemoryRecord {
  id: MemoryId
  scope: MemoryScope
  layer: MemoryLayer
  /** Present for floor-scoped memory. No agent may write another's. */
  floor: FloorId | null
  building: BuildingId | null
  text: string
  /** Where this came from: a task id, a conversation, a file, the owner. */
  source: string
  /** Kept in the always-on core rather than waiting to be recalled. */
  pinned: boolean
  confidence: number
  /** Recency and usefulness both feed ranking, so a fact earns its place. */
  useCount: number
  lastUsedAt: string | null
  /** Set by the curator when a fact is known to expire. */
  expiresAt: string | null
  createdAt: string
}

export type MemoryScope = 'floor' | 'building' | 'skyline'

export type MemoryLayer =
  | 'working'    // the live session, compressed past a threshold
  | 'episodic'   // what happened, timestamped
  | 'semantic'   // durable distilled fact
  | 'procedural' // a playbook that worked

export interface RecallQuery {
  text: string
  scopes: readonly MemoryScope[]
  layers?: readonly MemoryLayer[]
  limit: number
}

export interface RecallHit {
  record: MemoryRecord
  /** Combined keyword and vector score, after recency and usefulness weighting. */
  score: number
}
