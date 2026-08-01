import { test, mock } from "node:test";
import assert from "node:assert/strict";

import {
  EnvCredentialResolver,
  buildAuthorizationHeaderValue,
  type CredentialResolver,
  type ResolvedCredential,
} from "@/lib/scraper/credential-resolver";
import { prepareAuthenticatedFetch } from "@/lib/scraper/incremental/credential-fetch";
import { redactUrlForLog } from "@/lib/scraper/url-redaction";
import { redactErrorForSource } from "@/lib/scraper/incremental/discovery-run";

// A sentinel secret the fake resolver returns. Every persisted/logged surface
// scanned below must NEVER contain it (AC1).
const SENTINEL = "s3nt1nel-SECRET-TOKEN-do-not-leak";

/**
 * A FAKE resolver: maps a credentialRef NAME to a scripted result, so tests
 * never touch a real secret store. Mutating `secrets` behind a FIXED ref models
 * secret ROTATION (AC2).
 */
class FakeResolver implements CredentialResolver {
  secrets: Map<string, ResolvedCredential>;

  constructor(initial: Record<string, ResolvedCredential> = {}) {
    this.secrets = new Map(Object.entries(initial));
  }

  resolve(credentialRef: string): ResolvedCredential {
    return this.secrets.get(credentialRef) ?? { ok: false, status: "missing" };
  }
}

function headerResult(secret: string): ResolvedCredential {
  return {
    ok: true,
    kind: "header",
    headerName: "authorization",
    headerValue: buildAuthorizationHeaderValue(secret),
  };
}

function captureConsole(t: { mock: typeof mock }) {
  const lines: string[] = [];
  const push = (message?: unknown) => lines.push(String(message ?? ""));
  t.mock.method(console, "log", push);
  t.mock.method(console, "warn", push);
  t.mock.method(console, "error", push);
  return lines;
}

// ---------------------------------------------------------------------------
// Env-based default resolver
// ---------------------------------------------------------------------------

test("EnvCredentialResolver builds an in-memory Authorization header from the env value", () => {
  const resolver = new EnvCredentialResolver({ PROVIDER_TOKEN_REF: SENTINEL });
  const resolved = resolver.resolve("PROVIDER_TOKEN_REF");
  assert.equal(resolved.ok, true);
  if (!resolved.ok || resolved.kind !== "header") throw new Error("expected header");
  assert.equal(resolved.headerName, "authorization");
  assert.equal(resolved.headerValue, `Bearer ${SENTINEL}`);
});

test("EnvCredentialResolver reports missing for an absent or empty env value", () => {
  const resolver = new EnvCredentialResolver({ EMPTY_REF: "" });
  assert.deepEqual(resolver.resolve("ABSENT_REF"), { ok: false, status: "missing" });
  assert.deepEqual(resolver.resolve("EMPTY_REF"), { ok: false, status: "missing" });
});

// ---------------------------------------------------------------------------
// prepareAuthenticatedFetch — resolver + policy seam
// ---------------------------------------------------------------------------

test("public source needs no auth material", () => {
  const resolver = new FakeResolver();
  const prep = prepareAuthenticatedFetch(
    { canFetchAuthenticated: false, credentialRef: null },
    resolver,
  );
  assert.deepEqual(prep, { authorized: true, kind: "none" });
});

test("authenticated source with no credentialRef is a credential-missing pause", () => {
  const resolver = new FakeResolver();
  const prep = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: null },
    resolver,
  );
  assert.deepEqual(prep, { authorized: false, pauseCategory: "credential-missing" });
});

test("success returns the in-memory header for this request only", () => {
  const resolver = new FakeResolver({ PROVIDER_TOKEN_REF: headerResult(SENTINEL) });
  const prep = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: "PROVIDER_TOKEN_REF" },
    resolver,
  );
  assert.equal(prep.authorized, true);
  if (!prep.authorized || prep.kind !== "header") throw new Error("expected header");
  assert.equal(prep.headerValue, `Bearer ${SENTINEL}`);
});

test("each resolver failure maps to its sanitized pause category", () => {
  for (const status of ["missing", "expired", "rotated"] as const) {
    const resolver = new FakeResolver({ REF: { ok: false, status } });
    const prep = prepareAuthenticatedFetch(
      { canFetchAuthenticated: true, credentialRef: "REF" },
      resolver,
    );
    assert.deepEqual(prep, { authorized: false, pauseCategory: `credential-${status}` });
  }
});

test("AC2: rotating the secret behind a FIXED credentialRef needs no ref change", () => {
  const resolver = new FakeResolver({ PROVIDER_TOKEN_REF: { ok: false, status: "expired" } });
  const source = { canFetchAuthenticated: true, credentialRef: "PROVIDER_TOKEN_REF" };

  // Before rotation: expired → pause category.
  assert.deepEqual(prepareAuthenticatedFetch(source, resolver), {
    authorized: false,
    pauseCategory: "credential-expired",
  });

  // Rotate the SECRET behind the SAME ref (the credentialRef string is unchanged).
  resolver.secrets.set("PROVIDER_TOKEN_REF", headerResult("rotated-fresh-secret"));

  const after = prepareAuthenticatedFetch(source, resolver);
  assert.equal(after.authorized, true);
  if (!after.authorized || after.kind !== "header") throw new Error("expected header");
  assert.equal(after.headerValue, "Bearer rotated-fresh-secret");
});

test("source ISOLATION: one source's failing ref does not affect another's resolution", () => {
  const resolver = new FakeResolver({
    GOOD_REF: headerResult(SENTINEL),
    BAD_REF: { ok: false, status: "rotated" },
  });
  const good = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: "GOOD_REF" },
    resolver,
  );
  const bad = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: "BAD_REF" },
    resolver,
  );
  assert.equal(good.authorized, true);
  assert.deepEqual(bad, { authorized: false, pauseCategory: "credential-rotated" });
});

// ---------------------------------------------------------------------------
// Redaction (headline privacy invariant)
// ---------------------------------------------------------------------------

test("redactUrlForLog strips a signed URL's token query AND userinfo", () => {
  const signed =
    "https://user:pass@provider.example/media/42?token=" + SENTINEL + "&sig=abc123&exp=9999";
  const redacted = redactUrlForLog(signed);
  assert.equal(redacted, "https://provider.example/media/42?[redacted]");
  assert.ok(!redacted.includes(SENTINEL));
  assert.ok(!redacted.includes("pass"));
  assert.ok(!redacted.includes("sig="));
});

test("redactErrorForSource replaces signed-URL exception prose with a controlled reason", () => {
  const err = new Error(
    "HTTP 401 for https://provider.example/media/42?token=" + SENTINEL + "&sig=abc",
  );
  const redacted = redactErrorForSource(err);
  assert.equal(redacted, "discovery_source_failed");
  assert.ok(!redacted.includes(SENTINEL));
  assert.ok(!redacted.includes("token="));
  assert.ok(!redacted.includes("[redacted]"));
});

test("the resolver seam NEVER logs the secret or Authorization header value", (t) => {
  const lines = captureConsole(t);
  const resolver = new FakeResolver({ PROVIDER_TOKEN_REF: headerResult(SENTINEL) });

  // Success path (returns the header) and each failure path.
  prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: "PROVIDER_TOKEN_REF" },
    resolver,
  );
  prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: "ABSENT_REF" },
    resolver,
  );

  const all = lines.join("\n");
  assert.ok(!all.includes(SENTINEL), "secret must never be logged");
  assert.ok(!all.includes("Bearer "), "Authorization header value must never be logged");
});
