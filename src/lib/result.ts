/**
 * Domain command result/error contract library (REF-082).
 *
 * Defines a standard result type for command functions and provides:
 *   - Typed constructors for every failure category (not-found, validation,
 *     conflict, forbidden, unavailable, unexpected).
 *   - A {@link throwIfFailed} route helper that converts a domain failure into
 *     an {@link ApiError} throw so route handlers don't repeat the same
 *     `if (!result.ok) throw new ApiError(…)` boilerplate.
 *
 * Read-model helpers that return `null` for absent data should continue to do
 * so — forcing null-returning functions into this shape adds noise when absence
 * is a normal value rather than a command failure.  That contract is documented
 * in ADR-0010 and is NOT an oversight.
 */
import { ApiError } from "@/lib/api-handler";

// ── Types ──────────────────────────────────────────────────────────────────

/** The success branch of a domain result, merged with an optional payload `T`. */
export type DomainOk<T extends object = Record<never, never>> = { ok: true } & T;

/**
 * The failure branch of a domain result.
 * `status` is the HTTP status code that maps to this failure category.
 * `error`  is a client-safe message surfaced as-is in the API response body.
 */
export type DomainErr = { ok: false; error: string; status: number };

/**
 * Standard result type for domain command functions.
 *
 * Replace ad-hoc local shapes like:
 * ```ts
 * type ErrResult   = { ok: false; error: string; status: number };
 * type SimpleResult = { ok: true } | ErrResult;
 * type DataResult<T> = ({ ok: true } & T) | ErrResult;
 * ```
 * with `DomainResult` or `DomainResult<T>`.
 */
export type DomainResult<T extends object = Record<never, never>> = DomainOk<T> | DomainErr;

// ── Constructors ───────────────────────────────────────────────────────────

/** Returns a successful result with no extra payload fields. */
export function ok(): DomainOk;
/** Returns a successful result that merges `data` into the ok shape. */
export function ok<T extends object>(data: T): DomainOk<T>;
export function ok<T extends object>(data?: T): DomainOk | DomainOk<T> {
  return data === undefined ? { ok: true } : { ok: true, ...data };
}

/** Resource was not found — 404. */
export function notFound(message = "Not found"): DomainErr {
  return { ok: false, error: message, status: 404 };
}

/** Client-supplied input failed validation — 400. */
export function validationError(message: string): DomainErr {
  return { ok: false, error: message, status: 400 };
}

/** A business-rule conflict prevents the operation — 409. */
export function conflict(message: string): DomainErr {
  return { ok: false, error: message, status: 409 };
}

/** The caller is not authorized for this operation — 403. */
export function forbidden(message = "Forbidden"): DomainErr {
  return { ok: false, error: message, status: 403 };
}

/** A required upstream dependency is temporarily unavailable — 503. */
export function unavailable(message = "Service unavailable"): DomainErr {
  return { ok: false, error: message, status: 503 };
}

/** An unexpected or unclassified failure — 500. */
export function unexpected(message = "Unexpected error"): DomainErr {
  return { ok: false, error: message, status: 500 };
}

// ── Route helper ───────────────────────────────────────────────────────────

/**
 * Throws an {@link ApiError} if `result` is a failure, otherwise asserts the
 * success branch so callers can read payload fields without a second
 * type-narrowing check.
 *
 * @example
 * ```ts
 * const result = await renameList(id, userId, name);
 * throwIfFailed(result);
 * return NextResponse.json({ list: result.list }); // narrowed to DomainOk
 * ```
 */
export function throwIfFailed<T extends object>(
  result: DomainResult<T>,
): asserts result is DomainOk<T> {
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
}
