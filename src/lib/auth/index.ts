/**
 * Canonical auth/session public seam.
 *
 * NOTE: `@/lib/auth` currently resolves to `src/lib/auth.ts` (legacy shim)
 * while that file exists. Use `@/lib/auth/*` for direct canonical module
 * imports during the transition.
 */
export { authOptions } from "@/lib/auth/config";
export { buildProviders, getConfiguredProviders, type ProviderMeta } from "@/lib/auth/providers";
export { bootstrapFirstUser } from "@/lib/auth/bootstrap";
export { loadSession, sessionHasCapability, type AuthResult } from "@/lib/auth/session-core";
export {
  requireSession,
  requireOnboardedSession,
  requireCapability,
} from "@/lib/auth/session-guards";
