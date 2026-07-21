/**
 * Client-safe 3-state assignment status mapping (RW-061 PR2).
 *
 * No server-only imports; safe to import from both server components and
 * client islands.
 */

export type AssignmentStatusVariant = "success" | "primary" | "neutral";

export type AssignmentStatusDisplay = {
  label: string;
  variant: AssignmentStatusVariant;
};

/**
 * Maps an AssignmentStatus string to a human-readable label and Badge variant.
 *
 * - COMPLETED  → "Completed" (success)
 * - IN_PROGRESS → "In progress" (primary)
 * - ASSIGNED   → "Not started" (neutral)
 */
export function assignmentStatusDisplay(status: string): AssignmentStatusDisplay {
  switch (status) {
    case "COMPLETED":
      return { label: "Completed", variant: "success" };
    case "IN_PROGRESS":
      return { label: "In progress", variant: "primary" };
    default:
      return { label: "Not started", variant: "neutral" };
  }
}
