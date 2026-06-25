/**
 * Security governance package (REF-037).
 *
 * Groups all security-sensitive subsystems under a single, cohesive package
 * with narrow public boundaries. Submodules:
 *
 *   - `client-ip`        — trusted-proxy-aware client IP resolution (RW-027)
 *   - `csrf`             — same-origin enforcement for mutation requests (RW-028)
 *   - `events`           — security event monitoring & alerting (RW-029)
 *   - `audit`            — durable audit log with metadata redaction
 *   - `rate-limit`       — fixed-window rate limiter + shared DB store (RW-026)
 *
 * **Throwing vs best-effort:** `checkRateLimit*` and `checkSameOrigin` (when
 * the CSRF check fails and enforcement is on) throw `ApiError` and block the
 * request. `recordSecurityEvent`, `recordAuditLog`, and `tryRecordAuditLog`
 * are best-effort monitoring side effects and NEVER throw to the caller.
 *
 * Backward-compatible re-exports live in the original `src/lib/` files so
 * existing callers continue to work without import changes.
 */
export * from "@/lib/security/client-ip";
export * from "@/lib/security/csrf";
export * from "@/lib/security/events";
export * from "@/lib/security/audit";
// rate-limit re-exports clientIpKey from client-ip; export only its own symbols.
export { checkRateLimit, checkRateLimitByKey } from "@/lib/security/rate-limit/index";
export * from "@/lib/security/rate-limit/store";
