/**
 * Security header policy (REF-060).
 *
 * Single source of truth for the HTTP security headers emitted on every
 * response (US-024).  Extracted from next.config.ts so that next.config.ts,
 * middleware, and tests share the same definition.
 *
 * CSP uses 'unsafe-inline' + 'unsafe-eval' for script-src so Next.js
 * hydration and the blocking no-flash theme script in layout.tsx keep working
 * without per-request nonces.  See REF-060 for a future nonce migration plan.
 *
 * Image remote patterns and server external packages are co-located here so
 * header contract tests can cover the full deployment surface.
 */

export type SecurityHeader = { key: string; value: string };

/**
 * Baseline CSP directives.  Kept as a string array so callers can inspect
 * individual directives in tests without parsing the joined value.
 */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  // Next.js requires unsafe-inline for hydration chunks and the inline
  // theme script; unsafe-eval may be needed by some polyfills/dev tools.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // img-src: data/blob URIs for inline images; https: for article hero
  // images (rendered via plain <img>) and OAuth avatars.
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.api.cognitive.microsoft.com https://*.stt.speech.microsoft.com wss://*.stt.speech.microsoft.com https://*.tts.speech.microsoft.com",
  // media-src blob: needed for ArticleSpeech which creates a blob URL
  // from base64 audio returned by the speech API.
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  // manifest-src: allows the web app manifest at /manifest.webmanifest
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

/** Baseline headers present in all environments. */
const BASE_HEADERS: readonly SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: CSP_DIRECTIVES.join("; "),
  },
];

/** HSTS header — only safe in HTTPS/production deployments. */
const HSTS_HEADER: SecurityHeader = {
  key: "Strict-Transport-Security",
  value: "max-age=31536000; includeSubDomains",
};

/**
 * Build the full security header set for a given environment.
 *
 * @param opts.production  Defaults to `process.env.NODE_ENV === "production"`.
 *   Pass explicitly to test both code paths without mutating the environment.
 */
export function buildSecurityHeaders(opts: { production?: boolean } = {}): SecurityHeader[] {
  const production = opts.production ?? process.env.NODE_ENV === "production";
  return [...BASE_HEADERS, ...(production ? [HSTS_HEADER] : [])];
}

/**
 * OAuth avatar CDNs allowed through the Next.js image optimizer.
 *
 * Article hero images use a plain `<img>` tag (not the optimizer), so provider
 * CDN hosts are intentionally omitted.  Wildcard remotePatterns would allow
 * SSRF-style image proxying via /_next/image.
 */
export const IMAGE_REMOTE_PATTERNS: readonly { protocol: "https"; hostname: string }[] = [
  { protocol: "https", hostname: "lh3.googleusercontent.com" },
  { protocol: "https", hostname: "avatars.githubusercontent.com" },
];

/**
 * Packages that must remain external to the webpack bundle.
 *
 * The OpenTelemetry SDK and Azure Blob Storage SDK are server-only and rely on
 * native require-in-the-middle instrumentation / platform SDKs that must not
 * be bundled into the browser or Edge runtime.
 */
export const SERVER_EXTERNAL_PACKAGES: readonly string[] = [
  "@opentelemetry/sdk-node",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-trace-base",
  "@azure/storage-blob",
];
