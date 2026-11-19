/**
 * Pure presentation helpers shared by the admin review queues (candidate
 * review, canonical conflicts, deleted-article recovery).
 *
 * Kept free of the component graph so pure Node tests can import it.
 */

/** The shared `Badge` tone union. Mirrors `BadgeProps["variant"]`. */
export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger";

/** The machine-readable fields of a review mutation's JSON error body. */
export function errorBodyReason(body: unknown): { reason?: string; detail?: string; stale?: boolean } {
  if (body && typeof body === "object") {
    const b = body as { reason?: unknown; detail?: unknown; stale?: unknown };
    return {
      reason: typeof b.reason === "string" ? b.reason : undefined,
      detail: typeof b.detail === "string" ? b.detail : undefined,
      stale: b.stale === true,
    };
  }
  return {};
}

/** Badge tone + label per canonical-conflict status. */
const CONFLICT_STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  OPEN: { variant: "warning", label: "Open" },
  RESOLVED: { variant: "success", label: "Resolved" },
  DISMISSED: { variant: "neutral", label: "Dismissed" },
};

export function conflictStatusBadge(status: string): { variant: BadgeVariant; label: string } {
  return CONFLICT_STATUS_BADGE[status] ?? { variant: "neutral", label: status };
}
