import type { CanonicalConflictStatus } from "@prisma/client";

/** The canonical-conflict lifecycle statuses. Single source consumed by UI + server. */
export const CANONICAL_CONFLICT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export type CanonicalConflictStatusValue = (typeof CANONICAL_CONFLICT_STATUSES)[number];

type NoMissingStatus = Exclude<
  CanonicalConflictStatus,
  CanonicalConflictStatusValue
> extends never
  ? true
  : ["missing status", Exclude<CanonicalConflictStatus, CanonicalConflictStatusValue>];
type NoExtraStatus = Exclude<
  CanonicalConflictStatusValue,
  CanonicalConflictStatus
> extends never
  ? true
  : ["extra status", Exclude<CanonicalConflictStatusValue, CanonicalConflictStatus>];

const assertNoMissingStatus: NoMissingStatus = true;
const assertNoExtraStatus: NoExtraStatus = true;
void assertNoMissingStatus;
void assertNoExtraStatus;

export function isCanonicalConflictStatus(value: string): value is CanonicalConflictStatusValue {
  return (CANONICAL_CONFLICT_STATUSES as readonly string[]).includes(value);
}
