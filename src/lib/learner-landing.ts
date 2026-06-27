/**
 * Default learner landing destination (#799).
 *
 * Centralizes the "where should this user land after sign-in / onboarding?"
 * decision so the rule lives in exactly one place. When the Today Session
 * feature is enabled a learner's default landing becomes `/today`; otherwise it
 * stays `/dashboard`, so the flag is a clean rollback switch with NO change to
 * auth/session semantics — only the default landing target moves.
 *
 * Admins keep the Dashboard overview as their default landing (their own
 * destinations such as `/admin` are reached explicitly and are unaffected).
 * `/dashboard` always remains directly accessible as the overview page.
 *
 * Dependency-light (only the env-backed feature flag) so it is safe to import
 * from the Next.js middleware edge runtime as well as server components.
 */
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";

/** The overview/dashboard landing path. */
export const DASHBOARD_PATH = "/dashboard";
/** The Today Session learner workflow path. */
export const TODAY_PATH = "/today";

/**
 * Resolve the default landing path for an authenticated user.
 *
 * @param role Optional role string from the session (e.g. "Admin" | "Reader").
 *             Admins always land on the dashboard overview; everyone else lands
 *             on `/today` when the feature is enabled.
 */
export function defaultLandingPath(role?: string | null): string {
  if (role === "Admin") return DASHBOARD_PATH;
  return isTodaySessionFeatureEnabled() ? TODAY_PATH : DASHBOARD_PATH;
}
