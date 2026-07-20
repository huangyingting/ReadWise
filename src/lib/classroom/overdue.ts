/**
 * Client-safe assignment overdue helper (RW-061).
 *
 * Intentionally free of any server-only imports (no `@prisma/client`, no
 * `@/lib/prisma`) so it can be used from client components. Status is compared
 * against the `"COMPLETED"` string literal rather than the Prisma enum for the
 * same reason.
 */

const COMPLETED_STATUS = "COMPLETED";

/**
 * Returns true when an assignment is overdue: it has a due date, `now` is past
 * that due date, and it is not already completed.
 */
export function isAssignmentOverdue(
  dueDate: Date | string | null | undefined,
  status: string,
  now: Date,
): boolean {
  if (!dueDate) return false;
  if (status === COMPLETED_STATUS) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() > due.getTime();
}
