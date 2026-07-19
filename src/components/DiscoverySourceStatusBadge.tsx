import { Badge, type BadgeProps } from "@/components/ui/Badge";
import type { OperationalStatus } from "@/lib/scraper/incremental/observability";
import type {
  DiscoverySourceHealth,
  DiscoveryGapState,
} from "@prisma/client";

/** Operator-facing label per derived operational status (AC1). */
const STATUS_LABEL: Record<OperationalStatus, string> = {
  "healthy-caught-up": "Caught up",
  "healthy-backlog": "Backlog",
  partial: "Partial",
  stalled: "Stalled",
  "gap-detected": "Gap detected",
};

/** Badge tone per operational status. */
const STATUS_VARIANT: Record<OperationalStatus, BadgeProps["variant"]> = {
  "healthy-caught-up": "success",
  "healthy-backlog": "primary",
  partial: "warning",
  stalled: "danger",
  "gap-detected": "danger",
};

/**
 * Renders the single derived {@link OperationalStatus} as a coloured badge so an
 * operator can distinguish healthy/caught-up, healthy-with-backlog, partial,
 * stalled, and gap-detected at a glance, without inspecting the database (AC1).
 * The raw status is exposed via `data-status` + `title` for tooling/tests.
 */
export function DiscoverySourceStatusBadge({ status }: { status: OperationalStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} data-status={status} title={status}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Badge tone for the raw source health signal. */
export function healthBadgeVariant(health: DiscoverySourceHealth): BadgeProps["variant"] {
  switch (health) {
    case "HEALTHY":
      return "success";
    case "DEGRADED":
      return "warning";
    case "FAILING":
    case "BLOCKED":
      return "danger";
    default:
      return "neutral";
  }
}

/** Badge tone for the completeness gap state. */
export function gapBadgeVariant(gapState: DiscoveryGapState): BadgeProps["variant"] {
  switch (gapState) {
    case "DETECTED":
      return "danger";
    case "SUSPECTED":
      return "warning";
    default:
      return "neutral";
  }
}
