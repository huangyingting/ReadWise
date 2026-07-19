/**
 * PURE force-rescrape decision core (issue #1102, Phase 3.3).
 *
 * The decision logic for an audited, operator-only refresh of ONE known public
 * Article, with NO database, network, or clock access (pure-logic house style,
 * mirroring `backfill-policy.ts` / `ingest-outcome.ts` / `trigger-mode.ts`). The
 * thin `force-rescrape-commit.ts` / `force-rescrape-query.ts` do the Prisma I/O
 * and the impure `force-rescrape-runner.ts` does the fetch/validate; this module
 * owns ONLY the branch-free decisions:
 *
 *   1. {@link decideForceRescrapeEligibility} — may this Article be force-rescraped
 *      at all? It must be a KNOWN, PUBLIC, non-taken-down Article with a source
 *      URL to refetch. (The governing invariant is enforced structurally by the
 *      dedicated endpoint being the only caller — this gate is the per-target
 *      pre-flight.)
 *   2. {@link decideAnnotationMigrationGate} — the FAIL-CLOSED annotation-migration
 *      gate. If the Article has reader annotations/highlights that would need
 *      re-anchoring and NO migrator is wired (the #1102 state; #1103 wires the
 *      real migrator), the gate BLOCKS activation so the run records a controlled
 *      `annotation_migration_required` failure and RETAINS the old version — it
 *      NEVER silently migrates. With no annotations (or once #1103 wires a
 *      migrator) the gate passes.
 *   3. {@link decideForceRescrapeActivation} — the ordered validation gate over the
 *      impure fetch/sanitize/extract signals (body present → canonical identity →
 *      safety → quality) FOLLOWED by the annotation-migration gate. Any failing
 *      check yields a machine failure code (controlled failure, old version
 *      retained); only an all-clear proceeds to atomic activation.
 *
 * PRIVACY: every input here is a boolean / small enum / count and every output is
 * a machine code. This module never accepts, returns, logs, or persists article
 * content, a title, a URL, a secret, or any user-private text.
 */
import { ArticleVisibility } from "@prisma/client";

// ---------------------------------------------------------------------------
// Failure taxonomy (machine codes only — never content)
// ---------------------------------------------------------------------------

/**
 * Every controlled-failure reason a force-rescrape can record. A REJECTED row
 * uses a validation-gate reason; a FAILED row uses a fetch/internal reason. All
 * are secret-free machine codes stored in `ArticleContentVersion.failureReason`.
 */
export const FORCE_RESCRAPE_FAILURE_REASONS = [
  /** The impure fetch/extract seam could not obtain a replacement (FAILED). */
  "fetch_failed",
  /** Extraction produced no usable body (REJECTED — never overwrite with empty). */
  "empty_body",
  /** Safety/moderation check flagged the replacement body (REJECTED). */
  "unsafe_body",
  /** Deterministic quality-gate rejection of the replacement (REJECTED). */
  "quality_rejected",
  /** The refreshed page resolves to a DIFFERENT canonical identity (REJECTED). */
  "canonical_conflict",
  /** The refreshed identity is blocked/quarantined (REJECTED). */
  "blocked_identity",
  /** Reader annotations need re-anchoring but no migrator is wired (REJECTED, #1103 gate). */
  "annotation_migration_required",
  /** An unexpected error aborted the attempt after the pending lock was taken (FAILED). */
  "internal_error",
] as const;

export type ForceRescrapeFailureReason = (typeof FORCE_RESCRAPE_FAILURE_REASONS)[number];

/**
 * Failure reasons that terminate a PENDING version as FAILED (a fetch/extract or
 * internal abort). Every OTHER reason is a deliberate validation-gate refusal and
 * terminates the version as REJECTED. The commit uses this split to pick the
 * terminal status; both RETAIN the current ACTIVE version.
 */
export const FAILED_STATUS_REASONS: ReadonlySet<ForceRescrapeFailureReason> = new Set([
  "fetch_failed",
  "internal_error",
]);

// ---------------------------------------------------------------------------
// Eligibility (per-target pre-flight)
// ---------------------------------------------------------------------------

/** Why an Article may NOT be force-rescraped (sanitized category). */
export type ForceRescrapeIneligibleReason =
  /** No Article with the requested id exists. */
  | "not-found"
  /** The Article is not a PUBLIC library article (private imports are out of scope). */
  | "not-public"
  /** The Article has no source URL, so there is nothing to refetch. */
  | "missing-source-url"
  /** The Article is unpublished/archived/taken-down and must not be refreshed. */
  | "taken-down";

/** Metadata-only inputs the eligibility decision reads (never content/URLs). */
export type ForceRescrapeEligibilityInput = {
  /** Whether the target Article exists. */
  exists: boolean;
  /** The Article's visibility (only PUBLIC is eligible). */
  visibility: ArticleVisibility | null;
  /** Whether the Article carries a non-empty source URL to refetch. */
  hasSourceUrl: boolean;
  /** The Article's `takedownState` (only `active` is eligible). */
  takedownState: string | null;
};

/** Outcome of {@link decideForceRescrapeEligibility}. */
export type ForceRescrapeEligibilityDecision =
  | { eligible: true }
  | { eligible: false; reason: ForceRescrapeIneligibleReason };

/**
 * Decides whether ONE Article is a valid force-rescrape target. Pure. A target
 * must exist, be PUBLIC, carry a source URL, and be in the `active` takedown
 * state. Everything else is refused BEFORE any content version is created, so an
 * ineligible request never materializes a baseline or takes the pending lock.
 */
export function decideForceRescrapeEligibility(
  input: ForceRescrapeEligibilityInput,
): ForceRescrapeEligibilityDecision {
  if (!input.exists) return { eligible: false, reason: "not-found" };
  if (input.visibility !== ArticleVisibility.PUBLIC) return { eligible: false, reason: "not-public" };
  if (!input.hasSourceUrl) return { eligible: false, reason: "missing-source-url" };
  if (input.takedownState !== null && input.takedownState !== "active") {
    return { eligible: false, reason: "taken-down" };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Annotation-migration gate (fail-closed; injected migrator seam for #1103)
// ---------------------------------------------------------------------------

/** Inputs the annotation-migration gate reads (counts + a wiring flag). */
export type AnnotationMigrationGateInput = {
  /** Number of reader annotations/highlights anchored to the current content. */
  annotationCount: number;
  /**
   * Whether a re-anchoring migrator is wired. In #1102 this is ALWAYS false
   * (the migrator is deferred to #1103); #1103 supplies a real migrator and flips
   * this true so an annotated Article can activate behind the gate.
   */
  migratorWired: boolean;
};

/** Outcome of {@link decideAnnotationMigrationGate}. */
export type AnnotationMigrationGateDecision =
  | { pass: true; reason: "no-annotations" | "migrator-available" }
  | { pass: false; reason: "annotation-migration-required" };

/**
 * The FAIL-CLOSED annotation-migration gate. Passes when there are NO annotations
 * to re-anchor (nothing to migrate) OR a migrator is wired (#1103). Otherwise it
 * BLOCKS: an Article with reader annotations and no wired migrator must NOT have
 * its content swapped, because that would silently break every highlight's
 * offsets. Blocking here makes the run record a controlled
 * `annotation_migration_required` failure and retain the old active version.
 */
export function decideAnnotationMigrationGate(
  input: AnnotationMigrationGateInput,
): AnnotationMigrationGateDecision {
  if (input.annotationCount <= 0) return { pass: true, reason: "no-annotations" };
  if (input.migratorWired) return { pass: true, reason: "migrator-available" };
  return { pass: false, reason: "annotation-migration-required" };
}

// ---------------------------------------------------------------------------
// Activation validation gate (ordered checks + the migration gate)
// ---------------------------------------------------------------------------

/** How the refreshed page's canonical identity compares to the Article's. */
export type RescrapeCanonicalSignal =
  /** Same canonical identity — safe to swap. */
  | "match"
  /** Resolves to a DIFFERENT canonical — must fail closed. */
  | "conflict"
  /** Resolves to a blocked/quarantined identity — must fail closed. */
  | "blocked";

/** Safety/moderation verdict on the replacement body. */
export type RescrapeSafetySignal = "safe" | "unsafe";

/** Deterministic quality-gate verdict on the replacement body. */
export type RescrapeQualitySignal = "pass" | "reject";

/**
 * The normalized verdicts produced by the impure fetch → sanitize → extract →
 * quality → safety → canonical pipeline (the injected runner seam). METADATA
 * ONLY — booleans + small enums, never the body or a URL.
 */
export type RescrapeValidationSignals = {
  /** Whether extraction produced a non-empty replacement body. */
  bodyPresent: boolean;
  /** Canonical-identity comparison to the existing Article. */
  canonical: RescrapeCanonicalSignal;
  /** Safety/moderation verdict. */
  safety: RescrapeSafetySignal;
  /** Quality-gate verdict. */
  quality: RescrapeQualitySignal;
};

/** Inputs to {@link decideForceRescrapeActivation}. */
export type ForceRescrapeActivationInput = {
  signals: RescrapeValidationSignals;
  annotation: AnnotationMigrationGateInput;
};

/** Outcome of {@link decideForceRescrapeActivation}. */
export type ForceRescrapeActivationDecision =
  | { proceed: true }
  | { proceed: false; reason: ForceRescrapeFailureReason };

/**
 * Decides whether a fetched + validated replacement may be ATOMICALLY ACTIVATED,
 * or must be refused as a controlled failure (retaining the old version). Pure.
 *
 * The checks run in a fixed precedence so the recorded failure code is
 * deterministic: an empty body first (never overwrite with nothing), then the
 * canonical-identity checks (a refreshed page that resolves to a conflicting or
 * blocked identity fails closed — the Article's identity is sacred), then safety,
 * then quality, and FINALLY the fail-closed annotation-migration gate. Only when
 * every check clears does it return `{ proceed: true }`.
 */
export function decideForceRescrapeActivation(
  input: ForceRescrapeActivationInput,
): ForceRescrapeActivationDecision {
  const { signals, annotation } = input;

  if (!signals.bodyPresent) return { proceed: false, reason: "empty_body" };
  if (signals.canonical === "blocked") return { proceed: false, reason: "blocked_identity" };
  if (signals.canonical === "conflict") return { proceed: false, reason: "canonical_conflict" };
  if (signals.safety === "unsafe") return { proceed: false, reason: "unsafe_body" };
  if (signals.quality === "reject") return { proceed: false, reason: "quality_rejected" };

  const gate = decideAnnotationMigrationGate(annotation);
  if (!gate.pass) return { proceed: false, reason: "annotation_migration_required" };

  return { proceed: true };
}
