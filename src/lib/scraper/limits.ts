/**
 * Network limits for the scraper's outbound HTTP fetches (SSRF hardening).
 *
 * Delegates to runtime-config/scraper so env reads are centralized and
 * visible to the /api/ready health check. See ADR-0010.
 */
export { scraperMaxBytes, scraperTimeoutMs } from "@/lib/runtime-config/scraper";
