/**
 * Runtime configuration barrel — server-side environment feature flags.
 *
 * @server-only — Must never be imported from a "use client" file.
 * All sub-modules read from `process.env` at call time and are Node.js-only.
 * See docs/refactoring.md § REF-076.
 */
export * as ai from "@/lib/runtime-config/ai";
export * as speech from "@/lib/runtime-config/speech";
export * as push from "@/lib/runtime-config/push";
export * as rateLimit from "@/lib/runtime-config/rate-limit";
export * as observability from "@/lib/runtime-config/observability";
export * as security from "@/lib/runtime-config/security";
export * as analytics from "@/lib/runtime-config/analytics";
export * as runtime from "@/lib/runtime-config/runtime";
export type {
  FeatureConfig,
  ConfigIssue,
  ConfigCheckStatus,
  ConfigCheckReport,
  RuntimeConfigReport,
} from "@/lib/runtime-config/env";
