/**
 * Force-rescrape preparer canonical-resolver integration tests (#1129).
 *
 * Engine-agnostic like `final-identity-commit.test.ts`: runs on SQLite by default
 * under `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the ONLY database-touching path of the new
 * production preparer — `resolveRescrapeCanonicalSignal`'s real blocked-identity
 * probe (a read-only quarantine / open-conflict lookup) — composed with the REAL
 * #1092 identity resolver over a REAL provider URL. The pure fetch/extract/quality/
 * moderation/mapping branches are covered by `scraper-rescrape-preparer.test.ts`.
 *
 * Candidates carry a REAL provider key ("undark") so the shared PREFIX sweep can't
 * reach them; a local afterEach deletes the exact rows produced here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { CrawlCandidateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { deriveCanonicalIdentity } from "@/lib/scraper/url-identity";
import { resolveRescrapeCanonicalSignal } from "@/lib/scraper/incremental/rescrape-preparer";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const UNDARK = "undark";
const seededCandidateIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  if (seededCandidateIds.size > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { id: { in: [...seededCandidateIds] } } });
    seededCandidateIds.clear();
  }
});

/** A unique admissible undark article URL for this run. */
function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-canon/`;
}

test("canonical resolver: same-provider identity ⇒ match, then quarantined ⇒ blocked", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }

  const token = randomUUID().slice(0, 8);
  const sourceUrl = undarkUrl(token);
  const article = { id: "art_rescrape_x", sourceUrl, canonicalUrl: null };
  // No declared <link rel="canonical"> — the page still resolves to its own URL.
  const html = "<html><head></head><body>fresh</body></html>";

  // With no blocking ledger row, the refreshed page keeps its own identity.
  assert.equal(await resolveRescrapeCanonicalSignal(article, html), "match");

  // Seed a QUARANTINED candidate that claims this exact canonical identity.
  const canonicalKey = deriveCanonicalIdentity(sourceUrl, { owningProviderKey: UNDARK }).key;
  const seeded = await createCrawlCandidate({
    providerKey: UNDARK,
    provisionalKey: `v1:${UNDARK}:${token}:${randomUUID()}`,
    canonicalKey,
    status: CrawlCandidateStatus.QUARANTINED,
  });
  seededCandidateIds.add(seeded.id);

  // The identity is now blocked ⇒ the resolver fails closed to "blocked".
  assert.equal(await resolveRescrapeCanonicalSignal(article, html), "blocked");
});

test("canonical resolver: a foreign declared canonical ⇒ conflict (fail closed)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }

  const token = randomUUID().slice(0, 8);
  const sourceUrl = undarkUrl(token);
  const article = { id: "art_rescrape_y", sourceUrl, canonicalUrl: null };
  const html = `<html><head><link rel="canonical" href="https://random-aggregator.example/story/${token}"></head></html>`;

  assert.equal(await resolveRescrapeCanonicalSignal(article, html), "conflict");
});
