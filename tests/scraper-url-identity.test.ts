/**
 * Tests for versioned URL normalization + public article identity (issue #1082).
 *
 * The module under test (`src/lib/scraper/url-identity.ts`) is pure — no network,
 * no DB. Tests are table-driven for shared rules and representative provider
 * overrides, plus adversarial cases (encoded credentials, duplicate params,
 * Unicode/punycode hosts, associated domains, unknown cross-domain canonicals).
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  URL_IDENTITY_VERSION,
  UrlIdentityError,
  deriveProvisionalIdentity,
  deriveCanonicalIdentity,
  redactUrlForLog,
} from "@/lib/scraper/url-identity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const expectedKey = (normalizedUrl: string): string =>
  `${URL_IDENTITY_VERSION}:${createHash("sha256").update(normalizedUrl, "utf8").digest("hex")}`;

/** Asserts two raw URLs resolve to the SAME provisional identity key. */
const assertSameIdentity = (a: string, b: string, msg?: string): void => {
  assert.equal(
    deriveProvisionalIdentity(a).key,
    deriveProvisionalIdentity(b).key,
    msg ?? `expected same identity: ${a} vs ${b}`,
  );
};

/** Asserts two raw URLs resolve to DIFFERENT provisional identity keys. */
const assertDifferentIdentity = (a: string, b: string, msg?: string): void => {
  assert.notEqual(
    deriveProvisionalIdentity(a).key,
    deriveProvisionalIdentity(b).key,
    msg ?? `expected different identity: ${a} vs ${b}`,
  );
};

// ---------------------------------------------------------------------------
// Identity key shape + version
// ---------------------------------------------------------------------------

test("identity: version tag is v1", () => {
  assert.equal(URL_IDENTITY_VERSION, "v1");
});

test("identity: key is fixed-size versioned sha256 (v1:<64 hex>)", () => {
  const { key, identityVersion } = deriveProvisionalIdentity("https://example.com/a-story");
  assert.equal(identityVersion, "v1");
  assert.match(key, /^v1:[0-9a-f]{64}$/);
  assert.equal(key.length, 67);
});

test("identity: key is deterministic for the same normalized URL", () => {
  const a = deriveProvisionalIdentity("https://example.com/a-story");
  const b = deriveProvisionalIdentity("HTTPS://EXAMPLE.COM/a-story#frag");
  assert.equal(a.key, b.key);
  assert.equal(a.key, expectedKey("https://example.com/a-story"));
});

// ---------------------------------------------------------------------------
// Shared normalization rules (table-driven) — variants that MUST share identity
// ---------------------------------------------------------------------------

type EquivalenceCase = readonly [name: string, a: string, b: string];

const SHARED_EQUIVALENT: readonly EquivalenceCase[] = [
  ["scheme case", "https://example.com/story", "HTTPS://example.com/story"],
  ["hostname case", "https://EXAMPLE.com/story", "https://example.com/story"],
  ["fragment removal", "https://example.com/story#section-2", "https://example.com/story"],
  ["default https port", "https://example.com:443/story", "https://example.com/story"],
  ["default http port", "http://example.com:80/story", "http://example.com/story"],
  ["utm_ tracking params", "https://example.com/story?utm_source=nl&utm_medium=email", "https://example.com/story"],
  ["fbclid tracking", "https://example.com/story?fbclid=abc123", "https://example.com/story"],
  ["gclid tracking", "https://example.com/story?gclid=xyz", "https://example.com/story"],
  ["mixed tracking + real (real kept both sides)", "https://example.com/story?id=5&utm_source=x", "https://example.com/story?id=5"],
  ["query param order", "https://example.com/story?b=2&a=1", "https://example.com/story?a=1&b=2"],
];

for (const [name, a, b] of SHARED_EQUIVALENT) {
  test(`shared-equivalent: ${name}`, () => assertSameIdentity(a, b));
}

// ---------------------------------------------------------------------------
// Distinct content MUST NOT be merged by a generic rule
// ---------------------------------------------------------------------------

type DistinctCase = readonly [name: string, a: string, b: string];

const SHARED_DISTINCT: readonly DistinctCase[] = [
  ["different path", "https://example.com/story-a", "https://example.com/story-b"],
  ["different host", "https://a.example.com/story", "https://b.example.com/story"],
  ["different scheme", "http://example.com/story", "https://example.com/story"],
  ["non-default port", "https://example.com:8443/story", "https://example.com/story"],
  ["unknown query param kept", "https://example.com/story?ref=twitter", "https://example.com/story"],
  ["different unknown query value", "https://example.com/story?page=2", "https://example.com/story?page=3"],
  ["trailing slash preserved (generic)", "https://example.com/story/", "https://example.com/story"],
];

for (const [name, a, b] of SHARED_DISTINCT) {
  test(`shared-distinct: ${name}`, () => assertDifferentIdentity(a, b));
}

test("shared: unknown params are NOT stripped merely because inconvenient", () => {
  const { normalizedUrl } = deriveProvisionalIdentity("https://example.com/story?ref=news&q=hello");
  assert.equal(normalizedUrl, "https://example.com/story?q=hello&ref=news");
});

test("shared: duplicate query params are preserved and deterministically ordered", () => {
  const a = deriveProvisionalIdentity("https://example.com/s?a=2&a=1");
  const b = deriveProvisionalIdentity("https://example.com/s?a=1&a=2");
  assert.equal(a.normalizedUrl, "https://example.com/s?a=1&a=2");
  assert.equal(a.key, b.key);
});

// ---------------------------------------------------------------------------
// Provider override: natgeo — meaningfulParams: [] (drop ALL query params)
// ---------------------------------------------------------------------------

test("natgeo: drops all query params (meaningfulParams: [])", () => {
  const { normalizedUrl, providerKey } = deriveProvisionalIdentity(
    "https://www.nationalgeographic.com/animals/article/some-animal?loggedin=true&foo=bar",
  );
  assert.equal(providerKey, "natgeo");
  assert.equal(normalizedUrl, "https://www.nationalgeographic.com/animals/article/some-animal");
});

test("natgeo: distinct-param variants merge to ONE identity (provider-owned)", () => {
  assertSameIdentity(
    "https://www.nationalgeographic.com/science/article/x?a=1",
    "https://www.nationalgeographic.com/science/article/x?a=2",
  );
});

// ---------------------------------------------------------------------------
// Provider override: bbcfeatures — hostname alias + trailing-slash + assoc.
// ---------------------------------------------------------------------------

test("bbcfeatures: bbc.com folds to canonical www.bbc.com", () => {
  const bare = deriveProvisionalIdentity("https://bbc.com/future/article/20240101-a-story");
  const www = deriveProvisionalIdentity("https://www.bbc.com/future/article/20240101-a-story");
  assert.equal(bare.providerKey, "bbcfeatures");
  assert.equal(bare.key, www.key);
  assert.equal(bare.normalizedUrl, "https://www.bbc.com/future/article/20240101-a-story");
});

test("bbcfeatures: trailing slash stripped", () => {
  assertSameIdentity(
    "https://www.bbc.com/future/article/20240101-a-story/",
    "https://www.bbc.com/future/article/20240101-a-story",
  );
});

// ---------------------------------------------------------------------------
// Provider override: theconversation — AMP suffix folding + www alias
// ---------------------------------------------------------------------------

test("theconversation: /amp suffix folds to canonical article", () => {
  const amp = deriveProvisionalIdentity("https://theconversation.com/how-x-works-12345/amp");
  const canonical = deriveProvisionalIdentity("https://theconversation.com/how-x-works-12345");
  assert.equal(amp.providerKey, "theconversation");
  assert.equal(amp.key, canonical.key);
  assert.equal(amp.normalizedUrl, "https://theconversation.com/how-x-works-12345");
});

test("theconversation: www alias folds to bare host", () => {
  assertSameIdentity(
    "https://www.theconversation.com/how-x-works-12345",
    "https://theconversation.com/how-x-works-12345",
  );
});

test("provider policy is additive: an unconfigured provider keeps generic behavior", () => {
  // wired (undark has no urlIdentity) — non-tracking params must survive.
  const { normalizedUrl } = deriveProvisionalIdentity("https://undark.org/2024/01/01/a-story/?page=2");
  assert.match(normalizedUrl, /page=2/);
});

// ---------------------------------------------------------------------------
// SECURITY: credential/signature material must never leak
// ---------------------------------------------------------------------------

const SECRET_PARAM_URLS: readonly string[] = [
  "https://example.com/story?access_token=SECRET123",
  "https://example.com/story?token=SECRET123",
  "https://example.com/story?sig=SECRET123",
  "https://example.com/story?signature=SECRET123",
  "https://example.com/story?apikey=SECRET123",
  "https://example.com/story?api_key=SECRET123",
  "https://example.com/story?password=SECRET123",
  "https://example.com/story?sessionid=SECRET123",
  "https://example.com/story?X-Amz-Signature=SECRET123&X-Amz-Credential=SECRET456",
  "https://example.com/story?X-Goog-Signature=SECRET123",
  "https://example.com/story?jwt=SECRET123",
  "https://example.com/story?bearer=SECRET123",
];

for (const url of SECRET_PARAM_URLS) {
  test(`security: credential param dropped and never leaked — ${url.split("?")[1]}`, () => {
    const identity = deriveProvisionalIdentity(url);
    const blob = JSON.stringify(identity);
    assert.doesNotMatch(blob, /SECRET123/, "secret must not appear in identity output");
    assert.doesNotMatch(blob, /SECRET456/, "secret must not appear in identity output");
    assert.equal(identity.normalizedUrl, "https://example.com/story");
  });
}

test("security: signed URLs for the same resource share one identity", () => {
  assertSameIdentity(
    "https://cdn.example.com/story?X-Amz-Signature=aaa&X-Amz-Expires=100",
    "https://cdn.example.com/story?X-Amz-Signature=bbb&X-Amz-Expires=999",
  );
});

test("security: userinfo (user:pass@host) is stripped from normalized URL and key", () => {
  const withCreds = deriveProvisionalIdentity("https://alice:hunter2@example.com/story");
  const clean = deriveProvisionalIdentity("https://example.com/story");
  assert.equal(withCreds.key, clean.key);
  assert.equal(withCreds.normalizedUrl, "https://example.com/story");
  assert.doesNotMatch(JSON.stringify(withCreds), /hunter2|alice/);
});

test("security: percent-encoded userinfo is stripped too", () => {
  const withCreds = deriveProvisionalIdentity("https://user%40x:p%40ss@example.com/story");
  assert.equal(withCreds.normalizedUrl, "https://example.com/story");
  assert.doesNotMatch(JSON.stringify(withCreds), /p%40ss|p@ss/i);
});

test("security: redactUrlForLog removes userinfo, query, and fragment", () => {
  const redacted = redactUrlForLog("https://alice:hunter2@example.com/story?token=SECRET123#frag");
  assert.doesNotMatch(redacted, /hunter2|alice|SECRET123|frag/);
  assert.equal(redacted, "https://example.com/story?[redacted]");
});

test("security: redactUrlForLog never echoes an unparseable string", () => {
  assert.equal(redactUrlForLog("::not a url::token=SECRET123"), "[unparseable-url]");
});

test("security: invalid URL error message never echoes the input", () => {
  try {
    deriveProvisionalIdentity("not-a-url-token=SECRET123");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof UrlIdentityError);
    assert.equal(err.code, "invalid-url");
    assert.doesNotMatch(err.message, /SECRET123/);
  }
});

test("security: unsupported scheme is rejected", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.com", "file:///etc/passwd"]) {
    assert.throws(() => deriveProvisionalIdentity(bad), (err: unknown) => {
      return err instanceof UrlIdentityError && err.code === "unsupported-scheme";
    });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: Unicode / punycode hosts
// ---------------------------------------------------------------------------

test("adversarial: Unicode host and its punycode form share one identity", () => {
  assertSameIdentity("https://münchen.example/story", "https://xn--mnchen-3ya.example/story");
});

test("adversarial: mixed-case Unicode host normalizes deterministically", () => {
  const a = deriveProvisionalIdentity("https://MÜNCHEN.example/story");
  const b = deriveProvisionalIdentity("https://xn--mnchen-3ya.example/story");
  assert.equal(a.key, b.key);
});

// ---------------------------------------------------------------------------
// Canonical identity: ownership acceptance + rejection
// ---------------------------------------------------------------------------

test("canonical: same-provider canonical is accepted", () => {
  const id = deriveCanonicalIdentity("https://www.bbc.com/future/article/20240101-a-story", {
    owningProviderKey: "bbcfeatures",
  });
  assert.equal(id.providerKey, "bbcfeatures");
  assert.match(id.key, /^v1:[0-9a-f]{64}$/);
});

test("canonical: explicitly-associated domain is accepted, host preserved", () => {
  const id = deriveCanonicalIdentity("https://www.bbc.co.uk/future/article/20240101-a-story", {
    owningProviderKey: "bbcfeatures",
  });
  assert.equal(id.providerKey, "bbcfeatures");
  // Host is a different (associated) domain — must NOT be rewritten to www.bbc.com.
  assert.match(id.normalizedUrl, /^https:\/\/www\.bbc\.co\.uk\//);
});

test("canonical: a separately-registered provider is accepted (reruns own admission)", () => {
  // Canonical points at a DIFFERENT registered provider than the owner.
  const id = deriveCanonicalIdentity("https://theconversation.com/how-x-works-12345", {
    owningProviderKey: "bbcfeatures",
  });
  assert.equal(id.providerKey, "theconversation");
});

test("canonical: unknown cross-domain canonical is REJECTED", () => {
  assert.throws(
    () =>
      deriveCanonicalIdentity("https://evil.example/steal-identity", {
        owningProviderKey: "bbcfeatures",
      }),
    (err: unknown) =>
      err instanceof UrlIdentityError && err.code === "unknown-cross-domain-canonical",
  );
});

test("canonical: rejection message never leaks credential parts", () => {
  try {
    deriveCanonicalIdentity("https://user:pw@evil.example/x?token=SECRET123", {
      owningProviderKey: "bbcfeatures",
    });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof UrlIdentityError);
    assert.doesNotMatch(err.message, /SECRET123|pw|user:/);
  }
});

test("canonical: no owner + unregistered host is rejected", () => {
  assert.throws(
    () => deriveCanonicalIdentity("https://unknown-site.example/x"),
    (err: unknown) =>
      err instanceof UrlIdentityError && err.code === "unknown-cross-domain-canonical",
  );
});

test("canonical: applies the resolved provider's rules (bbc alias fold)", () => {
  const id = deriveCanonicalIdentity("https://bbc.com/future/article/20240101-a-story/", {
    owningProviderKey: "bbcfeatures",
  });
  assert.equal(id.normalizedUrl, "https://www.bbc.com/future/article/20240101-a-story");
});
