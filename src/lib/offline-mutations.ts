/**
 * @deprecated Thin re-export shim for backward compatibility (REF-021).
 *
 * The implementation has been moved to `@/lib/offline/sync-runtime`.
 * New code should import directly from `@/lib/offline` or `@/lib/offline/sync-runtime`.
 */
"use client";

export {
  MUTATION_HEADER,
  SYNC_TAG,
  type MutationSpec,
  type SubmitResult,
  type SyncState,
  subscribeSyncState,
  getSyncState,
  newClientMutationId,
  submitMutation,
  flushOfflineQueue,
  registerOfflineSync,
  purgeOfflineUserData,
} from "./offline/sync-runtime";
