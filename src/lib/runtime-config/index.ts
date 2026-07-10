/**
 * Runtime configuration barrel — server-side environment feature flags.
 *
 * @server-only — Must never be imported from a "use client" file.
 * All sub-modules read from `process.env` at call time and are Node.js-only.
 * See ADR-0010.
 */
export * as ai from "./ai";
export * as featureFlags from "./feature-flags";
export type { FeatureKey } from "./feature-flags";
export * as database from "./database";
export * as speech from "./speech";
export * as push from "./push";
export * as rateLimit from "./rate-limit";
export * as observability from "./observability";
export * as security from "./security";
export * as analytics from "./analytics";
export * as oauth from "./oauth";
export * as storage from "./storage";
export * as scraper from "./scraper";
export * as dictionary from "./dictionary";
export * as runtime from "./runtime";
export type {
  FeatureConfig,
  ConfigIssue,
  ConfigCheckStatus,
  ConfigCheckReport,
  RuntimeConfigReport,
} from "./env";
