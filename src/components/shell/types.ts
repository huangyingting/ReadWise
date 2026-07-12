import type { Role } from "@prisma/client";

/** Minimal, display-only user shape passed from the server layout to the shell. */
export interface ShellUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: Role;
  /**
   * Whether the Today Session feature is enabled server-side. Derived from
   * `FEATURE_TODAY_SESSION_ENABLED` in the RSC layout and threaded through
   * this shape so client components never import server runtime config.
   *
   * Defaults to false when absent (e.g. unauthenticated shell renders).
   */
  showTodayNav?: boolean;
}
