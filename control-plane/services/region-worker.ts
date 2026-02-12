/**
* Region Worker
* @deprecated Use @kernel/queue instead
* This file re-exports from kernel for backward compatibility
*/

// AUDIT-FIX P2-07: Use value export for DEFAULT_QUEUE_CONFIG (not type-only).
// Previously 'export type' was used for all three, but DEFAULT_QUEUE_CONFIG is
// a runtime value, not a type. Using 'export type' for it causes undefined at runtime.
export type { RegionWorker, QueueConfig } from '@kernel/queue';
export { DEFAULT_QUEUE_CONFIG } from '@kernel/queue';
