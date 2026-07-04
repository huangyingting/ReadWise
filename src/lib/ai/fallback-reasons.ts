import type { AiErrorKind } from "@/lib/ai/output/error-classifier";

export const AI_FALLBACK_REASONS = [
  "provider_unconfigured",
  "quota_exceeded",
  "validation_failed",
  "empty_response",
  "content_filter",
  "timeout",
  "rate_limited",
  "server_error",
  "auth_error",
  "bad_request",
  "network_error",
  "aborted",
  "provider_error",
  "unknown_error",
] as const;

export type AiFallbackReason = (typeof AI_FALLBACK_REASONS)[number];

const AI_FALLBACK_REASON_SET = new Set<string>(AI_FALLBACK_REASONS);

export function isAiFallbackReason(value: unknown): value is AiFallbackReason {
  return typeof value === "string" && AI_FALLBACK_REASON_SET.has(value);
}

export function normalizeAiFallbackReason(
  value: AiFallbackReason | string | null | undefined,
): AiFallbackReason | null {
  return isAiFallbackReason(value) ? value : null;
}

export function aiFallbackReasonForErrorKind(kind: AiErrorKind): AiFallbackReason {
  switch (kind) {
    case "unconfigured":
      return "provider_unconfigured";
    case "rate_limit":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "server":
      return "server_error";
    case "auth":
      return "auth_error";
    case "content_filter":
      return "content_filter";
    case "bad_request":
      return "bad_request";
    case "network":
      return "network_error";
    case "aborted":
      return "aborted";
    case "empty":
      return "empty_response";
    default:
      return "unknown_error";
  }
}
