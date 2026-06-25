/**
 * Offline mutation type and endpoint registry (REF-021).
 *
 * Enumerates every mutation type the client may queue offline. Any route that
 * must handle idempotent replay through the mutation queue must appear here.
 * Having a single registry makes queued mutations auditable and prevents future
 * routes from silently bypassing idempotency.
 */

/** All mutation types that may be queued and replayed offline. */
export type OfflineMutationType =
  | "progress"
  | "saveWord"
  | "removeWord"
  | "highlight.create"
  | "highlight.color"
  | "highlight.note"
  | "highlight.delete"
  | "quiz.attempt";

/** Registration record describing one allowed offline mutation type. */
export interface MutationRegistration {
  type: OfflineMutationType;
  /** Default HTTP method for this mutation type. */
  method: "POST" | "PATCH" | "DELETE";
  /** API path prefix(es) this type is allowed to target. */
  endpointPrefixes: readonly string[];
}

/**
 * Canonical registry of all offline-queued mutation types.
 *
 * Each entry documents which HTTP method and endpoint prefix a mutation type
 * uses so the queue is self-describing and operators can audit it without
 * reading every caller.
 */
export const OFFLINE_MUTATION_REGISTRY: readonly MutationRegistration[] = [
  {
    type: "progress",
    method: "POST",
    endpointPrefixes: ["/api/progress"],
  },
  {
    type: "saveWord",
    method: "POST",
    endpointPrefixes: ["/api/saved-words"],
  },
  {
    type: "removeWord",
    method: "DELETE",
    endpointPrefixes: ["/api/saved-words"],
  },
  {
    type: "highlight.create",
    method: "POST",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "highlight.color",
    method: "PATCH",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "highlight.note",
    method: "PATCH",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "highlight.delete",
    method: "DELETE",
    endpointPrefixes: ["/api/highlights"],
  },
  {
    type: "quiz.attempt",
    method: "POST",
    endpointPrefixes: ["/api/quiz"],
  },
] as const;

/** Returns true when `type` is a registered offline mutation type. */
export function isKnownMutationType(
  type: string,
): type is OfflineMutationType {
  return OFFLINE_MUTATION_REGISTRY.some((r) => r.type === type);
}

/** Look up the registration record for a mutation type, or undefined if unknown. */
export function getMutationRegistration(
  type: string,
): MutationRegistration | undefined {
  return OFFLINE_MUTATION_REGISTRY.find((r) => r.type === type);
}
