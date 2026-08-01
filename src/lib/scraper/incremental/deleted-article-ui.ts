/**
 * PURE, client-safe deleted-article recovery UI helpers (issue #1104, Phase 3.5).
 *
 * Owns the presentation contract for the admin deleted-identity recovery queue
 * WITHOUT any React/DOM/network: the client DTO shape (dates arrive as ISO
 * strings over the wire), the searchParams parsing + pagination bounds, the
 * terminal-reason/status label maps, and the recovery mutation-outcome
 * classification (conflict → refresh & retry, ineligible, not-found) the UI must
 * surface. Every value here is a sanitized id, versioned identity HASH, status,
 * COUNT, timestamp, or reason CATEGORY — never a URL, body, secret, or article
 * content (a deleted article's content is permanently gone).
 *
 * The client DTO field names are single-sourced from the backend recovery module
 * via `import type` (erased at runtime), so the UI stays type-safe; only the Date
 * fields are widened to the ISO strings the JSON API actually serializes.
 */
import { ApiResponseError, clientErrorMessage } from "@/lib/client-fetch";
import type { DeletedCandidateDto } from "@/lib/scraper/incremental/deleted-article-recovery";

/** The shared `Badge` tone union — kept local so this module stays free of the
 * component graph (it is imported by pure Node tests). Mirrors `BadgeProps["variant"]`. */
export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger";

// ---------------------------------------------------------------------------
// Client DTO shapes (dates serialize to ISO strings over the JSON API)
// ---------------------------------------------------------------------------

/** A single sanitized deleted-identity row (dates as ISO strings). */
export type DeletedCandidate = Omit<
  DeletedCandidateDto,
  "articleDeletedAt" | "ingestedAt" | "firstObservedAt" | "lastObservedAt"
> & {
  articleDeletedAt: string | null;
  ingestedAt: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
};

/** A bounded, filtered page of deleted identities + the total match count. */
export type DeletedCandidatePage = {
  candidates: DeletedCandidate[];
  total: number;
  offset: number;
  limit: number;
};

// ---------------------------------------------------------------------------
// Pagination bounds (match the API contract)
// ---------------------------------------------------------------------------

/** Default page size, matching the API default/cap (1–200, default 50). */
export const DEFAULT_DELETED_LIMIT = 50;
export const MAX_DELETED_LIMIT = 200;

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

/** Parses + clamps the `limit` searchParam to the API bounds. */
export function parseDeletedLimit(raw: string | undefined): number {
  return parseBoundedInt(raw, DEFAULT_DELETED_LIMIT, 1, MAX_DELETED_LIMIT);
}

/** Parses + clamps the `offset` searchParam (>= 0). */
export function parseDeletedOffset(raw: string | undefined): number {
  return parseBoundedInt(raw, 0, 0, Number.MAX_SAFE_INTEGER);
}

// ---------------------------------------------------------------------------
// Labels + badges (sanitized categories only)
// ---------------------------------------------------------------------------

/** The controlled terminal reason stamped on a governance-deleted identity. */
export const GOVERNANCE_DELETED_REASON = "governance:article-deleted";

const TERMINAL_REASON_LABELS: Record<string, string> = {
  [GOVERNANCE_DELETED_REASON]: "Article deleted (governance)",
};

/** Human label for a candidate's terminal reason category. */
export function terminalReasonLabel(reason: string | null): string {
  if (!reason) return "Unknown";
  return TERMINAL_REASON_LABELS[reason] ?? reason;
}

/** Badge tone + label for a deleted identity (governance state). */
export function deletedCandidateBadge(
  terminalReason: string | null,
): { variant: BadgeVariant; label: string } {
  if (terminalReason === GOVERNANCE_DELETED_REASON) {
    return { variant: "danger", label: "Deleted" };
  }
  return { variant: "neutral", label: terminalReason ?? "Unknown" };
}

// ---------------------------------------------------------------------------
// Recover reason validation (explicit re-admission action)
// ---------------------------------------------------------------------------

export const MIN_RECOVER_REASON = 1;
export const MAX_RECOVER_REASON = 500;

/** True when the audit reason is within the API's required 1–500 char bounds. */
export function isRecoverReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_RECOVER_REASON && trimmed.length <= MAX_RECOVER_REASON;
}

// ---------------------------------------------------------------------------
// Recover success response + mutation-outcome classification
// ---------------------------------------------------------------------------

/** The 200 response body for a successful deleted-identity recovery. */
export type RecoverResponse = {
  ok: true;
  outcome: "recovered";
  candidateId: string;
  jobId: string;
  dedupeKey: string;
  processingVersion: number;
};

/** The classified failure of a recovery mutation (thrown non-OK response). */
export type RecoverError =
  | { kind: "conflict"; message: string }
  | { kind: "ineligible"; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "generic"; message: string };

function errorBodyReason(body: unknown): { reason?: string; stale?: boolean } {
  if (body && typeof body === "object") {
    const b = body as { reason?: unknown; stale?: unknown };
    return {
      reason: typeof b.reason === "string" ? b.reason : undefined,
      stale: b.stale === true,
    };
  }
  return {};
}

/**
 * Maps a recovery HTTP status + server body to a {@link RecoverError}. PURE. A
 * 409 `conflict` (a concurrent recovery won, `stale: true`) prompts a refresh &
 * retry; a 409 `ineligible` means the candidate is not a deleted identity.
 */
export function recoverErrorFrom(
  status: number | null,
  body: unknown,
  message: string,
): RecoverError {
  const { reason, stale } = errorBodyReason(body);
  if (status === 409 && (reason === "conflict" || stale)) return { kind: "conflict", message };
  if (status === 409 && reason === "ineligible") return { kind: "ineligible", message };
  if (status === 400) return { kind: "validation", message };
  if (status === 404) return { kind: "notFound", message };
  if (status === 401 || status === 403) return { kind: "auth", message };
  return { kind: "generic", message };
}

/** Classifies a caught recovery error into a {@link RecoverError}. */
export function classifyRecoverError(err: unknown): RecoverError {
  if (err instanceof ApiResponseError) {
    return recoverErrorFrom(err.status, err.cause, err.message);
  }
  const message = clientErrorMessage(err, "Recovery failed.");
  return recoverErrorFrom(null, null, message);
}

/** True when a classified recovery error should prompt the operator to refresh. */
export function recoverNeedsRefresh(error: RecoverError): boolean {
  return error.kind === "conflict";
}

/** A human sentence describing a successful recovery outcome. */
export function describeRecoverOutcome(res: RecoverResponse): string {
  return `Re-admitted for re-ingestion (processing v${res.processingVersion}); a fresh ingest job was enqueued. This is not a content restore.`;
}
