/**
 * Backward-compat re-export shim (R2CI-1 / #627 → #676).
 *
 * The sensitive metadata redaction policy has moved to the security subsystem
 * (#676). This file re-exports the canonical names under the legacy aliases so
 * any remaining deep imports from this path continue to work without changes.
 *
 * Prefer importing from "@/lib/security/redaction" or "@/lib/security" for
 * new code.
 */
export {
  SENSITIVE_KEY_RE,
  isSensitiveKey,
  scrubValue,
} from "@/lib/security/redaction";
