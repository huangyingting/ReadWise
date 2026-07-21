/**
 * Compatibility re-export for scraper URL log redaction.
 *
 * The canonical redaction policy lives in `@/lib/security/redaction`; keep this
 * module so existing scraper imports continue to share the same helper.
 */
export { redactUrlForLog } from "@/lib/security/redaction";
