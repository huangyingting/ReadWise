/**
 * Canonical auth barrel — `@/lib/auth` resolves here.
 *
 * Submodules: config · providers · bootstrap · session-core · session-guards
 * Page-level session facade: `@/lib/session` (re-exports session-guards helpers).
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
