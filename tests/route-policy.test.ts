/**
 * Route protection policy contract tests (REF-060).
 *
 * These tests act as a ratchet: if someone adds a new entry to
 * PROTECTED_PREFIXES without a corresponding matcher, or removes a required
 * CSP directive, they fail immediately — no grep needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTED_PREFIXES,
  MIDDLEWARE_MATCHER,
  SESSION_COOKIES,
} from "@/lib/route-policy";
import {
  buildSecurityHeaders,
  CSP_DIRECTIVES,
  IMAGE_REMOTE_PATTERNS,
  SERVER_EXTERNAL_PACKAGES,
} from "@/lib/security/headers";

// ---------------------------------------------------------------------------
// Route / matcher drift detection
// ---------------------------------------------------------------------------

test("every protected prefix has a corresponding matcher entry", () => {
  for (const prefix of PROTECTED_PREFIXES) {
    const covered = MIDDLEWARE_MATCHER.some(
      (pattern) =>
        pattern === prefix ||
        pattern.startsWith(`${prefix}/`) ||
        pattern.startsWith(`${prefix}:`),
    );
    assert.ok(covered, `No matcher entry covers protected prefix: ${prefix}`);
  }
});

test("middleware matcher contains the landing-page root entry", () => {
  assert.ok(
    (MIDDLEWARE_MATCHER as readonly string[]).includes("/"),
    "Matcher must include '/' for the landing-page authenticated redirect",
  );
});

test("no matcher-only entries without a corresponding protected prefix", () => {
  // The landing-page "/" and the /:path* / root variants are expected extras.
  const prefixSet = new Set(PROTECTED_PREFIXES as readonly string[]);

  for (const pattern of MIDDLEWARE_MATCHER) {
    if (pattern === "/") continue;
    // Strip /:path* or trailing segments to recover the prefix.
    const prefix = pattern.replace(/\/:path\*$/, "").replace(/\/:[^/]+.*$/, "");
    assert.ok(
      prefixSet.has(prefix),
      `Matcher entry "${pattern}" has no matching protected prefix ("${prefix}")`,
    );
  }
});

test("session cookies include both plain and Secure variants", () => {
  assert.ok(
    SESSION_COOKIES.some((c) => c.startsWith("__Secure-")),
    "Must have a __Secure- cookie name for HTTPS deployments",
  );
  assert.ok(
    SESSION_COOKIES.some((c) => !c.startsWith("__Secure-")),
    "Must have a plain cookie name for HTTP-local dev",
  );
});

// ---------------------------------------------------------------------------
// Security header / CSP contract
// ---------------------------------------------------------------------------

const REQUIRED_CSP_PREFIXES = [
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "worker-src",
  "object-src 'none'",
  "manifest-src",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

test("CSP_DIRECTIVES exports all required directives", () => {
  for (const required of REQUIRED_CSP_PREFIXES) {
    const found = CSP_DIRECTIVES.some((d) => d.startsWith(required));
    assert.ok(found, `CSP_DIRECTIVES must include a directive starting with: ${required}`);
  }
});

test("buildSecurityHeaders includes CSP with all required directives", () => {
  const headers = buildSecurityHeaders();
  const csp = headers.find((h) => h.key === "Content-Security-Policy");
  assert.ok(csp, "Content-Security-Policy header must be present");

  for (const required of REQUIRED_CSP_PREFIXES) {
    assert.ok(
      csp.value.includes(required),
      `CSP header value must include directive: ${required}`,
    );
  }
});

test("HSTS is absent in non-production", () => {
  const headers = buildSecurityHeaders({ production: false });
  assert.equal(
    headers.some((h) => h.key === "Strict-Transport-Security"),
    false,
    "Strict-Transport-Security must NOT be emitted in non-production",
  );
});

test("HSTS is present in production", () => {
  const headers = buildSecurityHeaders({ production: true });
  const hsts = headers.find((h) => h.key === "Strict-Transport-Security");
  assert.ok(hsts, "Strict-Transport-Security must be emitted in production");
  assert.ok(
    hsts.value.includes("max-age="),
    "HSTS value must include max-age",
  );
  assert.ok(
    hsts.value.includes("includeSubDomains"),
    "HSTS value must include includeSubDomains",
  );
});

test("buildSecurityHeaders includes required baseline headers", () => {
  const headers = buildSecurityHeaders();
  const keys = new Set(headers.map((h) => h.key));

  for (const required of [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ]) {
    assert.ok(keys.has(required), `Baseline header must be present: ${required}`);
  }
});

// ---------------------------------------------------------------------------
// Image remote patterns and server external packages
// ---------------------------------------------------------------------------

test("image remote patterns cover expected OAuth CDNs", () => {
  const hostnames = IMAGE_REMOTE_PATTERNS.map((p) => p.hostname);
  assert.ok(hostnames.includes("lh3.googleusercontent.com"), "Google avatar CDN must be listed");
  assert.ok(
    hostnames.includes("avatars.githubusercontent.com"),
    "GitHub avatar CDN must be listed",
  );
  // All patterns must use https only (no wildcard protocol).
  for (const p of IMAGE_REMOTE_PATTERNS) {
    assert.equal(p.protocol, "https", `Pattern for ${p.hostname} must use protocol: https`);
  }
});

test("server external packages include OpenTelemetry SDK and Azure Blob", () => {
  assert.ok(
    SERVER_EXTERNAL_PACKAGES.includes("@opentelemetry/sdk-node"),
    "OTel SDK must be externalized",
  );
  assert.ok(
    SERVER_EXTERNAL_PACKAGES.includes("@azure/storage-blob"),
    "Azure Blob Storage SDK must be externalized",
  );
});
