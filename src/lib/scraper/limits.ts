/**
 * Network limits for the scraper's outbound HTTP fetches (SSRF hardening).
 *
 * Delegates to runtime-config/scraper so env reads are centralized and
 * visible to the /api/ready health check. See docs/refactoring.md § REF-076.
 */
export { scraperMaxBytes, scraperTimeoutMs } from "@/lib/runtime-config/scraper";
