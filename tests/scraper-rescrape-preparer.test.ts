/**
 * Unit tests for the production force-rescrape body-fetch preparer (#1129).
 *
 * Exercises `createProductionRescrapePreparer` through INJECTED fakes for every
 * seam (fetch, extract, quality, moderation, canonical) so no network or database
 * is touched, plus the exported PURE helpers `classifyCanonicalResolution` and
 * `parseCanonicalLink`, and the fail-closed guard of the production canonical
 * resolver. These are the fast unit gate (`npm test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { ScrapedArticle } from "@/lib/scraper/types";
import type { ContentQualityResult } from "@/lib/scraper/quality";
import type { FinalIdentityResolution } from "@/lib/scraper/incremental/final-identity";
import type { UrlIdentity } from "@/lib/scraper/url-identity";
import {
  classifyCanonicalResolution,
  createProductionRescrapePreparer,
  parseCanonicalLink,
  resolveRescrapeCanonicalSignal,
  type RescrapePreparerDeps,
} from "@/lib/scraper/incremental/rescrape-preparer";

// ---------------------------------------------------------------------------
// Fixtures + a preparer builder with deterministic default fakes
// ---------------------------------------------------------------------------

const ARTICLE = { id: "art_1", sourceUrl: "https://news.example.com/a", canonicalUrl: null };
const CTX = { article: ARTICLE, reason: "operator justification", now: new Date("2026-07-20T12:00:00Z") };

const HTML_WITH_CANONICAL =
  '<html><head><link rel="canonical" href="https://news.example.com/a"/></head><body>x</body></html>';

function scraped(overrides: Partial<ScrapedArticle> = {}): ScrapedArticle {
  return {
    title: "Fresh Title",
    author: "A. Writer",
    source: "Example News",
    sourceUrl: ARTICLE.sourceUrl,
    heroImage: "https://news.example.com/hero.jpg",
    excerpt: "A fresh excerpt.",
    content: "<p>Fresh replacement body with enough words.</p>",
    category: "world",
    publishedAt: new Date("2026-07-19T00:00:00Z"),
    wordCount: 640,
    readingMinutes: 3,
    ...overrides,
  };
}

function quality(grade: ContentQualityResult["grade"]): ContentQualityResult {
  return { grade, score: grade === "reject" ? 10 : 100, signals: [] };
}

/** Builds a preparer whose seams are deterministic fakes; override any per-test. */
function makePreparer(overrides: RescrapePreparerDeps = {}) {
  const deps: RescrapePreparerDeps = {
    fetchHtml: async () => HTML_WITH_CANONICAL,
    extract: () => scraped(),
    qualityGate: () => quality("ok"),
    moderate: () => ({ flagged: false }),
    deriveReaderText: (content) => content,
    resolveCanonical: async () => "match",
    ...overrides,
  };
  return createProductionRescrapePreparer(deps);
}

// ---------------------------------------------------------------------------
// Fetch / extract failure branches → fail closed
// ---------------------------------------------------------------------------

test("fetch throws (SSRF-blocked / timeout / network) ⇒ fetch-failure", async () => {
  const prepare = makePreparer({
    fetchHtml: async () => {
      throw new Error("blocked: unsafe-address");
    },
  });
  const result = await prepare(CTX);
  assert.deepEqual(result, { kind: "fetch-failure", reason: "fetch_failed" });
});

test("fetch rejects for a non-OK response ⇒ fetch-failure", async () => {
  const prepare = makePreparer({
    fetchHtml: async () => {
      throw new Error("HTTP 500");
    },
  });
  assert.equal((await prepare(CTX)).kind, "fetch-failure");
});

test("extract returns null (no usable replacement) ⇒ fetch-failure", async () => {
  const prepare = makePreparer({ extract: () => null });
  assert.equal((await prepare(CTX)).kind, "fetch-failure");
});

test("extract returns empty/whitespace content ⇒ fetch-failure", async () => {
  const prepare = makePreparer({ extract: () => scraped({ content: "   " }) });
  assert.equal((await prepare(CTX)).kind, "fetch-failure");
});

// ---------------------------------------------------------------------------
// Happy path + per-signal branches
// ---------------------------------------------------------------------------

test("happy path ⇒ prepared with bodyPresent/quality:pass/safety:safe/canonical:match", async () => {
  const prepare = makePreparer();
  const result = await prepare(CTX);
  assert.equal(result.kind, "prepared");
  if (result.kind !== "prepared") return;
  assert.deepEqual(result.signals, {
    bodyPresent: true,
    canonical: "match",
    safety: "safe",
    quality: "pass",
  });
  // Content maps 1:1 from the extracted article; canonical comes from the HTML.
  assert.equal(result.content.title, "Fresh Title");
  assert.equal(result.content.content, "<p>Fresh replacement body with enough words.</p>");
  assert.equal(result.content.wordCount, 640);
  assert.equal(result.content.sourceUrl, ARTICLE.sourceUrl);
  assert.equal(result.content.canonicalUrl, "https://news.example.com/a");
});

test("quality gate grade 'reject' ⇒ quality:'reject' (still prepared; runner fails it)", async () => {
  const prepare = makePreparer({ qualityGate: () => quality("reject") });
  const result = await prepare(CTX);
  assert.equal(result.kind, "prepared");
  if (result.kind === "prepared") assert.equal(result.signals.quality, "reject");
});

test("quality gate grade 'warn' ⇒ quality:'pass' (only reject maps to reject)", async () => {
  const prepare = makePreparer({ qualityGate: () => quality("warn") });
  const result = await prepare(CTX);
  if (result.kind === "prepared") assert.equal(result.signals.quality, "pass");
});

test("moderation flags the reader text ⇒ safety:'unsafe'", async () => {
  let sawText = "";
  const prepare = makePreparer({
    deriveReaderText: () => "reader text",
    moderate: (text) => {
      sawText = text;
      return { flagged: true };
    },
  });
  const result = await prepare(CTX);
  if (result.kind === "prepared") assert.equal(result.signals.safety, "unsafe");
  assert.equal(sawText, "reader text", "moderation runs over the derived reader text");
});

test("canonical resolver 'conflict' ⇒ canonical:'conflict'", async () => {
  const prepare = makePreparer({ resolveCanonical: async () => "conflict" });
  const result = await prepare(CTX);
  if (result.kind === "prepared") assert.equal(result.signals.canonical, "conflict");
});

test("canonical resolver 'blocked' ⇒ canonical:'blocked'", async () => {
  const prepare = makePreparer({ resolveCanonical: async () => "blocked" });
  const result = await prepare(CTX);
  if (result.kind === "prepared") assert.equal(result.signals.canonical, "blocked");
});

test("canonical resolver throwing ⇒ fail closed to canonical:'conflict'", async () => {
  const prepare = makePreparer({
    resolveCanonical: async () => {
      throw new Error("db down");
    },
  });
  const result = await prepare(CTX);
  if (result.kind === "prepared") assert.equal(result.signals.canonical, "conflict");
});

test("only sourceUrl is ever fetched (never canonicalUrl)", async () => {
  const fetched: string[] = [];
  const prepare = makePreparer({
    fetchHtml: async (url) => {
      fetched.push(url);
      return HTML_WITH_CANONICAL;
    },
  });
  await prepare({ ...CTX, article: { ...ARTICLE, canonicalUrl: "https://other.example.com/c" } });
  assert.deepEqual(fetched, [ARTICLE.sourceUrl]);
});

// ---------------------------------------------------------------------------
// Pure: classifyCanonicalResolution
// ---------------------------------------------------------------------------

function identity(key: string, providerKey: string | null = "news"): UrlIdentity {
  return { identityVersion: "url-identity-v1", key, normalizedUrl: "https://n/x", providerKey };
}

test("classify: keep-own-provider + matching key + not blocked ⇒ match", () => {
  const resolution: FinalIdentityResolution = { decision: "keep-own-provider", identity: identity("k1") };
  assert.equal(classifyCanonicalResolution({ resolution, ownedKey: "k1", blocked: false }), "match");
});

test("classify: keep-own-provider + matching key + blocked ⇒ blocked", () => {
  const resolution: FinalIdentityResolution = { decision: "keep-own-provider", identity: identity("k1") };
  assert.equal(classifyCanonicalResolution({ resolution, ownedKey: "k1", blocked: true }), "blocked");
});

test("classify: keep-own-provider + DIFFERENT key ⇒ conflict", () => {
  const resolution: FinalIdentityResolution = { decision: "keep-own-provider", identity: identity("k2") };
  assert.equal(classifyCanonicalResolution({ resolution, ownedKey: "k1", blocked: false }), "conflict");
});

test("classify: null owned key ⇒ conflict (cannot establish ownership)", () => {
  const resolution: FinalIdentityResolution = { decision: "keep-own-provider", identity: identity("k1") };
  assert.equal(classifyCanonicalResolution({ resolution, ownedKey: null, blocked: false }), "conflict");
});

test("classify: transfer-to-provider ⇒ conflict (different canonical owner)", () => {
  const resolution: FinalIdentityResolution = {
    decision: "transfer-to-provider",
    targetProviderKey: "other",
    identity: identity("k1", "other"),
  };
  assert.equal(classifyCanonicalResolution({ resolution, ownedKey: "k1", blocked: false }), "conflict");
});

test("classify: route-to-review ⇒ conflict (fail closed)", () => {
  const resolution: FinalIdentityResolution = {
    decision: "route-to-review",
    reason: "unknown-cross-domain-canonical",
    identity: null,
    targetProviderKey: null,
  };
  assert.equal(classifyCanonicalResolution({ resolution, ownedKey: "k1", blocked: false }), "conflict");
});

// ---------------------------------------------------------------------------
// Pure: parseCanonicalLink
// ---------------------------------------------------------------------------

test("parseCanonicalLink: rel before href (double quotes)", () => {
  assert.equal(
    parseCanonicalLink('<link rel="canonical" href="https://x.example/a">'),
    "https://x.example/a",
  );
});

test("parseCanonicalLink: href before rel (single quotes)", () => {
  assert.equal(
    parseCanonicalLink("<link href='https://x.example/b' rel='canonical'/>"),
    "https://x.example/b",
  );
});

test("parseCanonicalLink: extra attributes + whitespace", () => {
  assert.equal(
    parseCanonicalLink('<link  data-x="1"  rel = "canonical"  href = "https://x.example/c"  />'),
    "https://x.example/c",
  );
});

test("parseCanonicalLink: no canonical link ⇒ null", () => {
  assert.equal(parseCanonicalLink('<link rel="stylesheet" href="/s.css">'), null);
});

// ---------------------------------------------------------------------------
// Production canonical resolver: fail-closed guard (no network/provider)
// ---------------------------------------------------------------------------

test("resolveRescrapeCanonicalSignal: unregistered host ⇒ conflict (fail closed)", async () => {
  const signal = await resolveRescrapeCanonicalSignal(
    { id: "a", sourceUrl: "https://not-a-registered-provider.invalid/x", canonicalUrl: null },
    "<html></html>",
    async () => false,
  );
  assert.equal(signal, "conflict");
});
