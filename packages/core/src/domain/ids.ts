/** Branded id types, so a BuildingId can never be passed where a FloorId belongs. */
declare const brand: unique symbol
type Id<T extends string> = string & { readonly [brand]: T }

export type BuildingId = Id<'building'>
export type FloorId = Id<'floor'>
export type TaskId = Id<'task'>
export type MessageId = Id<'message'>
export type MemoryId = Id<'memory'>
export type ApprovalId = Id<'approval'>

export const asBuildingId = (s: string) => s as BuildingId
export const asFloorId = (s: string) => s as FloorId
export const asTaskId = (s: string) => s as TaskId
export const asMessageId = (s: string) => s as MessageId
export const asMemoryId = (s: string) => s as MemoryId
export const asApprovalId = (s: string) => s as ApprovalId
