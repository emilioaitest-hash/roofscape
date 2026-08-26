import type { BuildingId, FloorId, MessageId, TaskId, ApprovalId } from './ids.js'

/**
 * Agents do not converse. Delegation writes a record: a goal, how it will be
 * judged, what it may spend, and when it must give up.
 */
export interface Task {
  id: TaskId
  building: BuildingId
  assignedBy: FloorId
  assignedTo: FloorId
  goal: string
  /** How the assignee — and the reviewer — will know it is done. */
  acceptance: readonly string[]
  /** Guardrails. Exceeding any of these escalates rather than spends more. */
  limits: TaskLimits
  state: TaskState
  /** Set once the work returns. */
  result: TaskResult | null
  createdAt: string
  settledAt: string | null
}

export interface TaskLimits {
  tokens: number
  /** Wall-clock seconds before the task is abandoned. */
  timeoutSeconds: number
  /** How many further hand-offs this task may spawn. Zero means it must be done in person. */
  depth: number
}

export type TaskState =
  | 'queued'
  | 'working'
  | 'awaiting-review'
  | 'awaiting-approval'
  | 'done'
  | 'escalated'
  | 'abandoned'

export interface TaskResult {
  summary: string
  /** Branch names, file paths, URLs — whatever the work produced. */
  artifacts: readonly string[]
  tokensSpent: number
}

export type MessageKind =
  | 'task'
  | 'question'
  | 'answer'
  | 'review_request'
  | 'status'
  | 'artifact'
  | 'escalation'

export interface Message {
  id: MessageId
  building: BuildingId
  kind: MessageKind
  from: FloorId
  to: FloorId
  /** Threads a reply to what it answers. */
  inReplyTo: MessageId | null
  body: string
  readAt: string | null
  createdAt: string
}

/**
 * Anything that reaches the world outside the building stops at the lobby desk
 * and waits for a person.
 */
export interface Approval {
  id: ApprovalId
  building: BuildingId
  kind: 'hire' | 'publish' | 'send' | 'deploy' | 'spend' | 'merge'
  requestedBy: FloorId
  /** What will happen if this is granted, in plain language. */
  intent: string
  state: 'pending' | 'granted' | 'refused'
  decidedAt: string | null
  createdAt: string
}
