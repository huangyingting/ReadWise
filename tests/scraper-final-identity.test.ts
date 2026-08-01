/**
 * Unit tests for the PURE trusted-final-identity resolution + merge-winner
 * selection + fingerprint-match split (issue #1092, Phase 2.2).
 *
 * The module under test (`src/lib/scraper/incremental/final-identity.ts`) is
 * pure — no DB, no network, no clock — so these tests use FIXTURE final URLs /
 * canonicals and never touch a real network (per the issue's fixture rule).
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { getProvider } from "@/lib/scraper/providers";
import {
  admittedByProvider,
  decideFingerprintMatches,
  resolveFinalIdentity,
  selectMergeWinner,
  type MergeParticipant,
} from "@/lib/scraper/incremental/final-identity";

// ---------------------------------------------------------------------------
// resolveFinalIdentity
// ---------------------------------------------------------------------------

test("keep-own-provider: canonical on the same owning provider", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "https://undark.org/2026/01/15/why-the-sky-is-blue/",
    canonicalUrl: "https://undark.org/2026/01/15/why-the-sky-is-blue/",
  });
  assert.equal(r.decision, "keep-own-provider");
  assert.equal(r.decision === "keep-own-provider" && r.identity.providerKey, "undark");
});

test("keep-own-provider: canonical on an explicitly-associated domain preserves host", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "bbcfeatures",
    finalUrl: "https://www.bbc.com/future/article/20260115-a-feature-story",
    canonicalUrl: "https://www.bbc.co.uk/future/article/20260115-a-feature-story",
  });
  assert.equal(r.decision, "keep-own-provider");
  if (r.decision === "keep-own-provider") {
    assert.equal(r.identity.providerKey, "bbcfeatures");
    // Associated-domain host is preserved (never rewritten to the canonical host).
    assert.match(r.identity.normalizedUrl, /^https:\/\/www\.bbc\.co\.uk\//);
  }
});

test("transfer-to-provider: canonical owned by a DIFFERENT registered provider (admission re-run passes)", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "https://undark.org/2026/01/15/shared-syndicated-piece/",
    canonicalUrl: "https://theconversation.com/why-the-sky-is-blue-123456",
  });
  assert.equal(r.decision, "transfer-to-provider");
  assert.equal(r.decision === "transfer-to-provider" && r.targetProviderKey, "theconversation");
});

test("route-to-review: transfer target's admission policy REJECTS the URL (never silently accepted)", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "https://undark.org/2026/01/15/shared-piece/",
    // A theconversation host URL that is NOT an article (topic index) — fails the
    // target provider's admission filter.
    canonicalUrl: "https://theconversation.com/topics/climate-change",
  });
  assert.equal(r.decision, "route-to-review");
  assert.equal(r.decision === "route-to-review" && r.reason, "transfer-admission-rejected");
  assert.equal(r.decision === "route-to-review" && r.targetProviderKey, "theconversation");
});

test("route-to-review: unknown cross-domain canonical", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "https://undark.org/2026/01/15/a-piece/",
    canonicalUrl: "https://random-aggregator.example/story/123",
  });
  assert.equal(r.decision, "route-to-review");
  assert.equal(r.decision === "route-to-review" && r.reason, "unknown-cross-domain-canonical");
  assert.equal(r.decision === "route-to-review" && r.identity, null);
});

test("route-to-review: invalid and unsupported final URLs", () => {
  const invalid = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "not a url",
  });
  assert.equal(invalid.decision, "route-to-review");
  assert.equal(invalid.decision === "route-to-review" && invalid.reason, "invalid-final-url");

  const unsupported = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "ftp://undark.org/2026/01/15/a-piece/",
  });
  assert.equal(unsupported.decision, "route-to-review");
  assert.equal(
    unsupported.decision === "route-to-review" && unsupported.reason,
    "unsupported-scheme",
  );
});

test("canonical takes precedence over the fetched final URL", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "https://undark.org/2026/01/15/redirected-landing/",
    canonicalUrl: "https://theconversation.com/why-the-sky-is-blue-123456",
  });
  assert.equal(r.decision, "transfer-to-provider");
});

test("falls back to the final URL when no canonical is declared", () => {
  const r = resolveFinalIdentity({
    owningProviderKey: "undark",
    finalUrl: "https://undark.org/2026/01/15/why-the-sky-is-blue/",
    canonicalUrl: null,
  });
  assert.equal(r.decision, "keep-own-provider");
});

// ---------------------------------------------------------------------------
// admittedByProvider
// ---------------------------------------------------------------------------

test("admittedByProvider enforces pattern + filter", () => {
  const provider = getProvider("theconversation")!;
  assert.equal(admittedByProvider(provider, "https://theconversation.com/a-real-story-999"), true);
  assert.equal(admittedByProvider(provider, "https://theconversation.com/topics/x"), false);
  assert.equal(admittedByProvider(provider, "https://theconversation.com/"), false);
});

// ---------------------------------------------------------------------------
// selectMergeWinner
// ---------------------------------------------------------------------------

const p = (
  id: string,
  firstObservedAt: string,
  extra: Partial<MergeParticipant> = {},
): MergeParticipant => ({
  id,
  firstObservedAt: new Date(firstObservedAt),
  createdAt: new Date(extra.createdAt ?? firstObservedAt),
  hasArticle: extra.hasArticle ?? false,
  observedInBaseline: extra.observedInBaseline ?? false,
});

test("selectMergeWinner rejects an empty participant set", () => {
  assert.throws(
    () => selectMergeWinner([]),
    /requires at least one participant/,
  );
});

test("selectMergeWinner: single participant wins with no losers", () => {
  const d = selectMergeWinner([p("a", "2026-01-01T00:00:00Z")]);
  assert.deepEqual(d, { kind: "merge", winnerId: "a", loserIds: [] });
});

test("selectMergeWinner: earliest firstObservedAt wins", () => {
  const d = selectMergeWinner([
    p("late", "2026-02-01T00:00:00Z"),
    p("early", "2026-01-01T00:00:00Z"),
  ]);
  assert.equal(d.kind, "merge");
  assert.equal(d.kind === "merge" && d.winnerId, "early");
  assert.deepEqual(d.kind === "merge" && d.loserIds, ["late"]);
});

test("selectMergeWinner: createdAt then id tiebreak on equal firstObservedAt", () => {
  const d = selectMergeWinner([
    p("b", "2026-01-01T00:00:00Z", { createdAt: new Date("2026-01-01T00:00:05Z") }),
    p("a", "2026-01-01T00:00:00Z", { createdAt: new Date("2026-01-01T00:00:05Z") }),
  ]);
  assert.equal(d.kind === "merge" && d.winnerId, "a");
});

test("selectMergeWinner: a KNOWN Article wins even over an earlier fresh candidate (AC4)", () => {
  const d = selectMergeWinner([
    p("fresh-earlier", "2026-01-01T00:00:00Z"),
    p("known-article", "2026-03-01T00:00:00Z", { hasArticle: true }),
  ]);
  assert.equal(d.kind === "merge" && d.winnerId, "known-article");
  assert.deepEqual(d.kind === "merge" && d.loserIds, ["fresh-earlier"]);
});

test("selectMergeWinner: a baseline identity wins over an earlier fresh candidate", () => {
  const d = selectMergeWinner([
    p("fresh-earlier", "2026-01-01T00:00:00Z"),
    p("baseline", "2026-03-01T00:00:00Z", { observedInBaseline: true }),
  ]);
  assert.equal(d.kind === "merge" && d.winnerId, "baseline");
});

test("selectMergeWinner: two KNOWN Articles are unmergeable → review", () => {
  const d = selectMergeWinner([
    p("art-1", "2026-01-01T00:00:00Z", { hasArticle: true }),
    p("art-2", "2026-02-01T00:00:00Z", { hasArticle: true }),
  ]);
  assert.deepEqual(d, { kind: "review", reason: "multiple-known-articles" });
});

// ---------------------------------------------------------------------------
// decideFingerprintMatches
// ---------------------------------------------------------------------------

test("decideFingerprintMatches splits same-provider vs cross-provider", () => {
  const d = decideFingerprintMatches("undark", [
    { candidateId: "same-1", providerKey: "undark" },
    { candidateId: "cross-1", providerKey: "theconversation" },
    { candidateId: "same-2", providerKey: "undark" },
  ]);
  assert.deepEqual(d.sameProviderIds, ["same-1", "same-2"]);
  assert.deepEqual(d.crossProviderIds, ["cross-1"]);
});
