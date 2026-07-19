/**
 * Explicit trigger-mode taxonomy for admin / CLI incremental discovery
 * requests (issue #1097, Phase 2.7).
 *
 * PURE logic only — no database, network, or clock. A normal operator trigger
 * declares a MODE; only `incremental` (the default) is implemented in this
 * phase. `backfill` and `force-rescrape` are DEFINED so the taxonomy is stable
 * and the API/CLI can reject them EXPLICITLY ("not implemented until Phase 3")
 * rather than silently falling through to the old synchronous discover-and-save
 * behavior (AC3).
 *
 * The validator is strict: an unknown string is rejected, and a
 * defined-but-unimplemented mode returns a typed `not-implemented` rejection.
 * Combined with the object-schema dropping unknown keys, a normal trigger input
 * CANNOT smuggle a bypass / force flag (AC1/AC3).
 */

/** Every defined trigger mode (implemented AND deferred). */
export const TRIGGER_MODES = ["incremental", "backfill", "force-rescrape"] as const;

export type TriggerMode = (typeof TRIGGER_MODES)[number];

/** The default mode when a trigger omits an explicit `mode`. */
export const DEFAULT_TRIGGER_MODE: TriggerMode = "incremental";

/**
 * Modes actually implemented in this phase. `backfill` and `force-rescrape` are
 * deliberately EXCLUDED — they are Phase-3 work (non-goal here) and must fail
 * explicitly until then.
 */
export const IMPLEMENTED_TRIGGER_MODES: readonly TriggerMode[] = ["incremental"];

/** Why a requested trigger mode was refused (sanitized category). */
export type TriggerModeRejection =
  /** The value is not one of the defined trigger modes at all. */
  | { ok: false; reason: "unknown-mode"; message: string }
  /** A defined but not-yet-implemented mode (deferred to Phase 3). */
  | { ok: false; reason: "not-implemented"; mode: TriggerMode; message: string };

/** A validated, implemented trigger mode. */
export type TriggerModeResult = { ok: true; mode: TriggerMode } | TriggerModeRejection;

function isTriggerMode(value: unknown): value is TriggerMode {
  return typeof value === "string" && (TRIGGER_MODES as readonly string[]).includes(value);
}

/**
 * Validates a requested trigger mode. Returns the implemented mode on success;
 * an `unknown-mode` rejection for anything not in {@link TRIGGER_MODES}; and a
 * `not-implemented` rejection (naming the mode) for a defined mode that is not
 * yet implemented. An omitted mode defaults to {@link DEFAULT_TRIGGER_MODE}.
 */
export function validateTriggerMode(input: unknown): TriggerModeResult {
  const requested = input == null ? DEFAULT_TRIGGER_MODE : input;
  if (!isTriggerMode(requested)) {
    return {
      ok: false,
      reason: "unknown-mode",
      message: `Unknown trigger mode. Supported: ${IMPLEMENTED_TRIGGER_MODES.join(", ")}.`,
    };
  }
  if (!IMPLEMENTED_TRIGGER_MODES.includes(requested)) {
    return {
      ok: false,
      reason: "not-implemented",
      mode: requested,
      message: `Trigger mode "${requested}" is not implemented yet (deferred to Phase 3). Use "incremental".`,
    };
  }
  return { ok: true, mode: requested };
}
