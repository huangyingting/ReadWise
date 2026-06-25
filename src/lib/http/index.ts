/**
 * External HTTP client layer (REF-073).
 *
 * Network policy categories:
 *  - `provider`  — {@link providerFetch}: trusted, fixed provider endpoints
 *                  (dictionary API, Azure Speech STS token, etc.)
 *  - `untrusted` — `src/lib/scraper/fetch.ts` (SSRF-pinned, user-supplied URLs)
 *  - `azure-sdk` — Azure SDK manages its own transport (AI completions, Storage)
 *  - `push`      — `web-push` library manages delivery
 *  - `client`    — `src/lib/client-fetch.ts` (browser-side JSON helpers)
 */
export {
  providerFetch,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  type ProviderFetchOptions,
} from "./provider-client";
