/**
 * Canonical Today-domain feature-gate policy (#962).
 *
 * All six throwing Today routes share this single gate definition.  Only the
 * GET /api/today route stays separate because it returns a NextResponse instead
 * of throwing.
 *
 * Dependency direction: today-session → errors/api-error, runtime-config.
 * runtime-config must NOT import from today-session.
 */

import { ApiError } from "@/lib/errors/api-error";
import {
  defineFeatureGate,
  enforceFeatureGate,
  type FeatureGate,
} from "@/lib/runtime-config/feature-flags";

/** Gate shared by the six Today routes that throw ApiError(404) when off. */
export const TODAY_THROWING_GATE: FeatureGate<null, never> =
  defineFeatureGate<null, never>({
    feature: "todaySession",
    whenDisabled: (): never => {
      throw new ApiError(404, "Not found");
    },
  });

/**
 * Enforce the Today route feature gate.
 * Throws `ApiError(404, "Not found")` if `todaySession` is disabled;
 * returns `undefined` when enabled (typed as `never | undefined`).
 */
export function enforceTodayGate(): never | undefined {
  return enforceFeatureGate(TODAY_THROWING_GATE, null);
}
