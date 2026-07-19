/**
 * Pure classification tests for atomic paged discovery commit (issue #1085,
 * Phase 1.5).
 *
 * The module under test (`src/lib/scraper/incremental/classify.ts`) is PURE — no
 * network, no DB. These table-driven tests cover the full outcome vocabulary:
 * policy rejection (invalid/unsupported/no-provider/admission), source
 * ownership, date provenance, existing identity, and the review/outside-window
 * frontier outcomes. Real providers (undark) exercise the true admission rules.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { CandidateDateProvenance, DiscoverySourceLifecycleMode } from "@prisma/client";

import {
  classifyPage,
  identityCompositeKey,
  pageItemFromDiscoveredUrl,
  type DiscoveryPageItem,
  type PageClassificationContext,
  type PageItemOutcomeKind,
  type PolicyRejectionReason,
} from "@/lib/scraper/incremental/classify";
import { identityVersionToInt } from "@/lib/scraper/incremental/baseline-backfill";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVE = DiscoverySourceLifecycleMode.ACTIVE;
const BASELINE = DiscoverySourceLifecycleMode.BASELINE;
const SHADOW = DiscoverySourceLifecycleMode.SHADOW;

/** A real, admissible undark article URL (date form → passes pattern + filter). */
const UNDARK_ARTICLE = "https://undark.org/2024/06/15/a-real-undark-article/";
const DATED = new Date("2024-06-15T00:00:00.000Z");

function context(overrides: Partial<PageClassificationContext> = {}): PageClassificationContext {
  return {
    lifecycleMode: ACTIVE,
    windowStart: null,
    knownIdentityKeys: new Set(),
    ...overrides,
  };
}

function compositeKeyFor(url: string): string {
  const identity = deriveProvisionalIdentity(url);
  assert.ok(identity.providerKey, `expected a provider for ${url}`);
  return identityCompositeKey(
    identity.providerKey,
    identityVersionToInt(identity.identityVersion),
    identity.key,
  );
}

function classifyOne(item: DiscoveryPageItem, ctx: PageClassificationContext) {
  const [result] = classifyPage([item], ctx);
  return result;
}

// ---------------------------------------------------------------------------
// Policy rejection (table-driven)
// ---------------------------------------------------------------------------

const REJECTION_CASES: Array<{ name: string; url: string; reason: PolicyRejectionReason }> = [
  { name: "unparseable URL", url: "not-a-valid-url", reason: "invalid-url" },
  { name: "empty host URL", url: "http://", reason: "invalid-url" },
  { name: "unsupported scheme", url: "ftp://undark.org/2024/06/15/x/", reason: "unsupported-scheme" },
  { name: "no registered provider", url: "https://example.com/2024/06/15/x/", reason: "no-registered-provider" },
  { name: "admission pattern miss", url: "https://undark.org/tag/climate-change/", reason: "admission-pattern" },
  { name: "admission filter miss", url: "https://undark.org/about/", reason: "admission-filter" },
];

for (const testCase of REJECTION_CASES) {
  test(`policy-rejected: ${testCase.name}`, () => {
    const result = classifyOne({ url: testCase.url }, context());
    assert.equal(result.outcome, "policy-rejected");
    assert.equal(result.rejectionReason, testCase.reason);
  });
}

test("rejected items still produce a stable, non-raw observation key", () => {
  const invalid = classifyOne({ url: "not-a-valid-url" }, context());
  assert.ok(invalid.observationKey.startsWith("url:"));
  assert.ok(!invalid.observationKey.includes("not-a-valid-url"));

  const withStableId = classifyOne({ url: "not-a-valid-url", stableId: "abc123" }, context());
  assert.equal(withStableId.observationKey, "id:abc123");

  // Admission rejections keep the derived versioned identity key + identity.
  const admission = classifyOne({ url: "https://undark.org/about/" }, context());
  assert.equal(admission.observationKey, deriveProvisionalIdentity("https://undark.org/about/").key);
  assert.ok(admission.identity, "admission rejection should still resolve identity");
  assert.equal(admission.identity?.providerKey, "undark");
});

// ---------------------------------------------------------------------------
// Source ownership
// ---------------------------------------------------------------------------

test("source ownership: registered host resolves the owning provider identity", () => {
  const result = classifyOne({ url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.URL }, context());
  assert.equal(result.identity?.providerKey, "undark");
  assert.equal(result.identity?.identityVersion, identityVersionToInt(deriveProvisionalIdentity(UNDARK_ARTICLE).identityVersion));
  assert.equal(result.identity?.provisionalKey, deriveProvisionalIdentity(UNDARK_ARTICLE).key);
});

test("source ownership: unregistered host is never assigned an identity", () => {
  const result = classifyOne({ url: "https://example.com/2024/06/15/x/" }, context());
  assert.equal(result.outcome, "policy-rejected");
  assert.equal(result.identity, null);
});

// ---------------------------------------------------------------------------
// Existing identity (precedence over mode/date in every mode)
// ---------------------------------------------------------------------------

for (const mode of [ACTIVE, BASELINE, SHADOW]) {
  test(`existing-identity wins in ${mode} mode`, () => {
    const known = new Set([compositeKeyFor(UNDARK_ARTICLE)]);
    const result = classifyOne(
      { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.FEED },
      context({ lifecycleMode: mode, knownIdentityKeys: known }),
    );
    assert.equal(result.outcome, "existing-identity");
    assert.equal(result.identity?.providerKey, "undark");
  });
}

// ---------------------------------------------------------------------------
// Baseline / shadow observation (new identity, no article ever)
// ---------------------------------------------------------------------------

for (const mode of [BASELINE, SHADOW]) {
  test(`baseline-shadow: new identity in ${mode} mode is observed, never eligible`, () => {
    const result = classifyOne(
      { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.FEED },
      context({ lifecycleMode: mode, windowStart: new Date("2000-01-01T00:00:00.000Z") }),
    );
    assert.equal(result.outcome, "baseline-shadow");
    assert.equal(result.trustedPublishedAt?.getTime(), DATED.getTime());
    assert.equal(result.dateProvenance, CandidateDateProvenance.FEED);
  });
}

// ---------------------------------------------------------------------------
// Date provenance + ACTIVE frontier window outcomes
// ---------------------------------------------------------------------------

test("date provenance: dated + after window → eligible with preserved provenance", () => {
  const result = classifyOne(
    { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.FEED },
    context({ windowStart: new Date("2024-01-01T00:00:00.000Z") }),
  );
  assert.equal(result.outcome, "eligible");
  assert.equal(result.trustedPublishedAt?.getTime(), DATED.getTime());
  assert.equal(result.dateProvenance, CandidateDateProvenance.FEED);
});

test("date provenance: dated at/before window → outside-window", () => {
  const atBoundary = classifyOne(
    { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.FEED },
    context({ windowStart: DATED }),
  );
  assert.equal(atBoundary.outcome, "outside-window", "boundary is exclusive");

  const before = classifyOne(
    { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.FEED },
    context({ windowStart: new Date("2025-01-01T00:00:00.000Z") }),
  );
  assert.equal(before.outcome, "outside-window");
});

test("date provenance: undated (no date) → review-required", () => {
  const result = classifyOne({ url: UNDARK_ARTICLE }, context({ windowStart: null }));
  assert.equal(result.outcome, "review-required");
  assert.equal(result.trustedPublishedAt, null);
  assert.equal(result.dateProvenance, CandidateDateProvenance.UNKNOWN);
});

test("date provenance: date present but UNKNOWN provenance is treated as undated", () => {
  const result = classifyOne(
    { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.UNKNOWN },
    context(),
  );
  assert.equal(result.outcome, "review-required");
  assert.equal(result.trustedPublishedAt, null);
});

test("no window lower bound: any dated item is eligible", () => {
  const result = classifyOne(
    { url: UNDARK_ARTICLE, publishedAt: new Date("1999-01-01T00:00:00.000Z"), dateProvenance: CandidateDateProvenance.URL },
    context({ windowStart: null }),
  );
  assert.equal(result.outcome, "eligible");
});

// ---------------------------------------------------------------------------
// Whole-page classification + provenance mapper
// ---------------------------------------------------------------------------

test("classifyPage assigns exactly one outcome per item, in order", () => {
  const items: DiscoveryPageItem[] = [
    { url: UNDARK_ARTICLE, publishedAt: DATED, dateProvenance: CandidateDateProvenance.FEED },
    { url: "https://undark.org/about/" },
    { url: "not-a-valid-url" },
  ];
  const results = classifyPage(items, context({ windowStart: new Date("2024-01-01T00:00:00.000Z") }));
  const outcomes = results.map((r) => r.outcome) as PageItemOutcomeKind[];
  assert.deepEqual(outcomes, ["eligible", "policy-rejected", "policy-rejected"]);
});

test("pageItemFromDiscoveredUrl maps channel to a default provenance", () => {
  const rss = pageItemFromDiscoveredUrl({ url: UNDARK_ARTICLE, source: "rss", publishedAt: "2024-06-15T00:00:00.000Z" });
  assert.equal(rss.dateProvenance, CandidateDateProvenance.FEED);
  assert.equal(rss.publishedAt?.getTime(), DATED.getTime());

  const sitemap = pageItemFromDiscoveredUrl({ url: UNDARK_ARTICLE, source: "sitemap", publishedAt: "2024-06-15T00:00:00.000Z" });
  assert.equal(sitemap.dateProvenance, CandidateDateProvenance.PAGE_METADATA);

  const seed = pageItemFromDiscoveredUrl({ url: UNDARK_ARTICLE, source: "seed", publishedAt: "2024-06-15T00:00:00.000Z" });
  assert.equal(seed.dateProvenance, CandidateDateProvenance.URL);

  const undated = pageItemFromDiscoveredUrl({ url: UNDARK_ARTICLE, source: "rss" });
  assert.equal(undated.publishedAt, undefined);
  assert.equal(undated.dateProvenance, undefined);
});
