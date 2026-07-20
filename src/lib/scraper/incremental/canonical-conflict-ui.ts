/**
 * PURE, client-safe canonical-conflict UI helpers (issue #1104, Phase 3.5).
 *
 * Owns the presentation contract for the admin canonical-conflict queue WITHOUT
 * any React/DOM/network: the client DTO shapes (dates arrive as ISO strings over
 * the wire), the searchParams parsing + pagination bounds, the status label/badge
 * maps, the sanitized dependent-data COUNT formatters, and the resolution
 * mutation-outcome classification (idempotent no-op, stale, survivor-not-a-
 * participant, no-participants) the UI must surface. Every value here is a
 * sanitized id, versioned identity HASH, status, COUNT, timestamp, or reason
 * CATEGORY — never a URL, body, secret, or article content.
 *
 * The client DTO field names are single-sourced from the backend query module via
 * `import type` (erased at runtime), so the UI stays type-safe; only the Date
 * fields are widened to the ISO strings the JSON API actually serializes.
 */
import { ApiResponseError } from "@/lib/client-fetch";
import type {
  CanonicalConflictDetailDto,
  CanonicalConflictDto,
  DependentDataCounts,
} from "@/lib/scraper/incremental/canonical-conflict-query";
import type { ReaderDataMigrationSummary } from "@/lib/scraper/incremental/canonical-conflict-migrate";
import type {
  ConflictKind,
  TypeBCanonicalChoice,
} from "@/lib/scraper/incremental/canonical-conflict-policy";

// Re-exported so the client components share one import surface for the sanitized
// dependent-data count shape (single source of truth: the backend query module).
export type { DependentDataCounts };
// The resolver-agreeing conflict discriminator + the Type-B canonical choice union
// are single-sourced from the pure policy module (runtime-erased `import type`).
export type { ConflictKind, TypeBCanonicalChoice };

/** The shared `Badge` tone union — kept local so this module stays free of the
 * component graph (it is imported by pure Node tests). Mirrors `BadgeProps["variant"]`. */
export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger";

// ---------------------------------------------------------------------------
// Client DTO shapes (dates serialize to ISO strings over the JSON API)
// ---------------------------------------------------------------------------

/** A single sanitized canonical-conflict row (dates as ISO strings). */
export type CanonicalConflict = Omit<CanonicalConflictDto, "detectedAt" | "resolvedAt"> & {
  detectedAt: string;
  resolvedAt: string | null;
};

/** One contested participant Article + its dependent-data COUNTS (detail only). */
export type ConflictArticle = {
  articleId: string;
  dependentData: DependentDataCounts;
};

/** The detail DTO adds the per-Article dependent-data breakdown. */
export type CanonicalConflictDetail = Omit<
  CanonicalConflictDetailDto,
  "detectedAt" | "resolvedAt"
> & {
  detectedAt: string;
  resolvedAt: string | null;
};

/** A bounded, filtered page of canonical conflicts + the total match count. */
export type CanonicalConflictPage = {
  conflicts: CanonicalConflict[];
  total: number;
  offset: number;
  limit: number;
};

// ---------------------------------------------------------------------------
// Status filter + pagination bounds (match the API contract)
// ---------------------------------------------------------------------------

/** The three conflict statuses the queue filters on (default OPEN). */
export const CONFLICT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** Default page size, matching the API default/cap (1–200, default 50). */
export const DEFAULT_CONFLICT_LIMIT = 50;
export const MAX_CONFLICT_LIMIT = 200;

export function isConflictStatus(value: string): value is ConflictStatus {
  return (CONFLICT_STATUSES as readonly string[]).includes(value);
}

/** Clamp helper shared by the page's searchParams parsing + the tests. PURE. */
export function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Parses the `status` searchParam, defaulting to OPEN. */
export function parseConflictStatus(raw: string | undefined): ConflictStatus {
  return raw && isConflictStatus(raw) ? raw : "OPEN";
}

/** Parses + clamps the `limit` searchParam to the API bounds. */
export function parseConflictLimit(raw: string | undefined): number {
  return parseBoundedInt(raw, DEFAULT_CONFLICT_LIMIT, 1, MAX_CONFLICT_LIMIT);
}

/** Parses + clamps the `offset` searchParam (>= 0). */
export function parseConflictOffset(raw: string | undefined): number {
  return parseBoundedInt(raw, 0, 0, Number.MAX_SAFE_INTEGER);
}

// ---------------------------------------------------------------------------
// Labels + badges (sanitized categories only)
// ---------------------------------------------------------------------------

/** Human labels for the conflict-status filter segments. */
export const CONFLICT_STATUS_LABELS: Record<ConflictStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

/** Badge tone + label per conflict status surfaced in the queue/detail. */
const CONFLICT_STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  OPEN: { variant: "warning", label: "Open" },
  RESOLVED: { variant: "success", label: "Resolved" },
  DISMISSED: { variant: "neutral", label: "Dismissed" },
};

export function conflictStatusBadge(status: string): { variant: BadgeVariant; label: string } {
  return CONFLICT_STATUS_BADGE[status] ?? { variant: "neutral", label: status };
}

// ---------------------------------------------------------------------------
// Dependent-data COUNT formatting (never content — only aggregate counts)
// ---------------------------------------------------------------------------

/** The ordered dependent-data fields + human labels (sanitized COUNTS only). */
export const DEPENDENT_DATA_FIELDS: ReadonlyArray<{ key: keyof DependentDataCounts; label: string }> = [
  { key: "highlights", label: "Highlights" },
  { key: "readingProgress", label: "Reading progress" },
  { key: "readingListItems", label: "Reading list" },
  { key: "articleMastery", label: "Mastery" },
  { key: "quizAttempts", label: "Quiz attempts" },
  { key: "pronunciationAttempts", label: "Pronunciation" },
  { key: "tutorMessages", label: "Tutor messages" },
  { key: "difficultyFeedback", label: "Difficulty feedback" },
];

/** Total reader/learning records attached to the contested Article(s). */
export function totalDependentData(counts: DependentDataCounts): number {
  return DEPENDENT_DATA_FIELDS.reduce((sum, field) => sum + (counts[field.key] ?? 0), 0);
}

/** The non-zero dependent-data fields as label/value pairs (detail breakdown). */
export function dependentDataItems(
  counts: DependentDataCounts,
): Array<{ label: string; value: number }> {
  return DEPENDENT_DATA_FIELDS.map((field) => ({ label: field.label, value: counts[field.key] ?? 0 })).filter(
    (item) => item.value > 0,
  );
}

/** A compact one-line summary of the dependent reader/learning data (counts only). */
export function summarizeDependentData(counts: DependentDataCounts): string {
  const total = totalDependentData(counts);
  if (total === 0) return "No reader data";
  const items = dependentDataItems(counts)
    .map((item) => `${item.value} ${item.label.toLowerCase()}`)
    .join(" · ");
  return `${total} record${total === 1 ? "" : "s"} · ${items}`;
}

// ---------------------------------------------------------------------------
// Resolve reason validation (destructive/governance action)
// ---------------------------------------------------------------------------

export const MIN_RESOLVE_REASON = 1;
export const MAX_RESOLVE_REASON = 500;

/** True when the audit reason is within the API's required 1–500 char bounds. */
export function isResolveReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_RESOLVE_REASON && trimmed.length <= MAX_RESOLVE_REASON;
}

// ---------------------------------------------------------------------------
// Resolve success response + mutation-outcome classification
// ---------------------------------------------------------------------------

/** The 200 response body for a single conflict resolution (applied vs no-op). */
export type ConflictResolveResponse =
  | {
      ok: true;
      outcome: "applied";
      conflictId: string;
      survivingArticleId: string;
      loserArticleIds: string[];
      survivorCandidateId: string;
      /** Present ONLY when the operator opted into reader-data migration (#1134). Counts only. */
      migration?: ReaderDataMigrationSummary;
    }
  | {
      /** A runtime (Type B) conflict resolved by an explicit canonical decision (#1135). */
      ok: true;
      outcome: "applied-type-b";
      conflictId: string;
      canonical: TypeBCanonicalChoice;
      winnerCandidateId: string;
      loserCandidateId: string | null;
      /** The incumbent's produced Article archived when the challenger was promoted, else null. */
      archivedArticleId: string | null;
    }
  | {
      ok: true;
      outcome: "noop";
      conflictId: string;
      reason: string;
      status: string;
    };

/** The classified failure of a resolution mutation (thrown non-OK response). */
export type ConflictResolveError =
  | { kind: "stale"; message: string }
  | { kind: "notParticipant"; message: string }
  | { kind: "noParticipants"; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "generic"; message: string };

function errorBodyReason(body: unknown): { reason?: string; detail?: string; stale?: boolean } {
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

/**
 * Maps a resolution HTTP status + server body to a {@link ConflictResolveError}.
 * PURE. A 409 `stale` prompts a refresh & retry; a 400 illegal
 * `survivor-not-a-participant` is a bad selection; a 409 illegal `no-participants`
 * means the conflict has nothing to resolve onto.
 */
export function conflictResolveErrorFrom(
  status: number | null,
  body: unknown,
  message: string,
): ConflictResolveError {
  const { reason, detail, stale } = errorBodyReason(body);
  if (status === 409 && (reason === "stale" || stale)) return { kind: "stale", message };
  // A kind mismatch (or a vanished incumbent/challenger candidate) means the
  // conflict changed underneath us; a refresh reloads the correct selector shape.
  if (
    status === 409 &&
    reason === "illegal" &&
    (detail === "wrong-conflict-type" ||
      detail === "incumbent-candidate-missing" ||
      detail === "challenger-candidate-missing")
  ) {
    return { kind: "stale", message };
  }
  if (status === 400 && reason === "illegal" && detail === "survivor-not-a-participant") {
    return { kind: "notParticipant", message };
  }
  if (status === 409 && reason === "illegal" && detail === "no-participants") {
    return { kind: "noParticipants", message };
  }
  if (status === 400) return { kind: "validation", message };
  if (status === 404) return { kind: "notFound", message };
  if (status === 401 || status === 403) return { kind: "auth", message };
  return { kind: "generic", message };
}

/** Classifies a caught resolution error into a {@link ConflictResolveError}. */
export function classifyConflictResolveError(err: unknown): ConflictResolveError {
  if (err instanceof ApiResponseError) {
    return conflictResolveErrorFrom(err.status, err.cause, err.message);
  }
  const message = err instanceof Error ? err.message : "Resolution failed.";
  return conflictResolveErrorFrom(null, null, message);
}

/** True when a classified resolve error should prompt the operator to refresh. */
export function conflictResolveNeedsRefresh(error: ConflictResolveError): boolean {
  return error.kind === "stale";
}

const RESOLVE_NOOP_LABELS: Record<string, string> = {
  "already-resolved": "already resolved",
  "already-dismissed": "already dismissed",
};

export function resolveNoopLabel(reason: string): string {
  return RESOLVE_NOOP_LABELS[reason] ?? reason;
}

/**
 * A compact, count-only summary of an opt-in reader-data migration (#1134):
 * how many reader/learning records were moved onto the survivor (repointed +
 * merged) and how many were left on the originals (skipped). Counts only.
 */
export function summarizeMigration(migration: ReaderDataMigrationSummary): string {
  let migrated = 0;
  let skipped = 0;
  for (const counts of Object.values(migration)) {
    migrated += counts.repointed + counts.merged;
    skipped += counts.skipped;
  }
  if (migrated === 0 && skipped === 0) return "no reader data to migrate";
  const parts = [`${migrated} reader record${migrated === 1 ? "" : "s"} migrated`];
  if (skipped > 0) parts.push(`${skipped} left on the original article${skipped === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** A human sentence describing a single resolution outcome (applied / type-b / no-op). */
export function describeResolveOutcome(res: ConflictResolveResponse): string {
  if (res.outcome === "applied") {
    const losers = res.loserArticleIds.length;
    const base = `Resolved — ${losers} losing article${losers === 1 ? "" : "s"} archived out of public feeds`;
    return res.migration
      ? `${base}; ${summarizeMigration(res.migration)}.`
      : `${base}; reader data retained.`;
  }
  if (res.outcome === "applied-type-b") {
    if (res.canonical === "incumbent") {
      return "Resolved — incumbent kept canonical; the challenger was folded in as a duplicate.";
    }
    const archived = res.archivedArticleId
      ? " and its produced article archived out of public feeds (retained)"
      : "";
    return `Resolved — challenger promoted canonical; the incumbent was folded in${archived}.`;
  }
  return `No change — ${resolveNoopLabel(res.reason)}.`;
}
