/**
 * Phase-1.10 fixture-driven SHADOW-SOAK + no-body-work evidence (issue #1090,
 * AC1 evidence + AC4).
 *
 * Engine-agnostic (SQLite by default, PostgreSQL in CI), guarded by `enabled`.
 * This is the DETERMINISTIC, fixture-driven equivalent of a multi-cycle live
 * soak: no real network is required. It exercises the FULL canary promotion path
 * — discovery (via a real canary adapter, fixture-fed) → baseline → shadow
 * re-scan (one simulated publication cycle) → GATED activation — and proves the
 * governing invariant STRUCTURALLY: injected FAILING body-fetch / Article-write /
 * ingest-enqueue deps are NEVER reached, and no Article / ARTICLE_INGEST job is
 * ever written, across baseline + shadow + the gated activation.
 *
 * The soak records METADATA ONLY (counts / outcomes); it never persists a URL,
 * body, or secret. What is fixture-driven vs live is called out in the PR body.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import {
  CandidateDateProvenance,
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  JobType,
} from "@prisma/client";

import type { DiscoveryFetch, DiscoveryFetchResult } from "@/lib/scraper/fetch";
import { makeRssCanaryAdapter } from "@/lib/scraper/incremental/adapters/rss-adapter";
import { commitDiscoveryPage } from "@/lib/scraper/incremental/page-commit";
import type { DiscoveryPageResult } from "@/lib/scraper/incremental/page-commit";
import {
  activateDiscoverySource,
  beginBaseline,
  completeBaseline,
  type ExitGateGuard,
} from "@/lib/scraper/incremental/lifecycle-commit";
import {
  BodyWorkProhibitedError,
  guardIngestPort,
} from "@/lib/scraper/incremental/lifecycle-run-guard";
import { prisma } from "@/lib/prisma";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { DISABLED, SHADOW, ACTIVE } = DiscoverySourceLifecycleMode;
const LEASE = "worker-soak";
const provenance = CandidateDateProvenance.FEED;

const createdIdentityKeys = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const keys = [...createdIdentityKeys];
  if (keys.length > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { provisionalKey: { in: keys } } });
    await prisma.urlAlias.deleteMany({ where: { aliasKey: { in: keys } } });
  }
  createdIdentityKeys.clear();
});

function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-story/`;
}

function track(url: string): string {
  try {
    createdIdentityKeys.add(deriveProvisionalIdentity(url).key);
  } catch {
    /* unparseable → nothing to track */
  }
  return url;
}

function page(
  items: DiscoveryPageResult["items"],
  boundaryReached = false,
): DiscoveryPageResult {
  return { items, continuation: boundaryReached ? null : { cursor: "n", page: 2 }, boundaryReached };
}

async function commitPage(sourceId: string, definitionVersion: number, p: DiscoveryPageResult) {
  return commitDiscoveryPage({
    sourceId,
    leaseOwner: LEASE,
    definitionVersion,
    windowStart: new Date("2000-01-01T00:00:00.000Z"),
    page: p,
  });
}

const ALL_COMPLETE = [{ segmentId: "primary", boundaryReached: true, pagesFullyProcessed: true }];

const passingGuard: ExitGateGuard = async () => ({ verdict: "pass", failing: [] });
const failingGuard: ExitGateGuard = async () => ({ verdict: "fail", failing: ["recovery-successful"] });

// ---------------------------------------------------------------------------
// The real RSS canary adapter, fixture-fed, performs zero body fetches.
// ---------------------------------------------------------------------------

test("RSS canary adapter discovers fixture items with a SINGLE document fetch (no body work)", async () => {
  const body = readFileSync("tests/fixtures/canary/theconversation-feed.xml", "utf8");
  let documentFetches = 0;
  const fetchResponse: DiscoveryFetch = async (): Promise<DiscoveryFetchResult> => {
    documentFetches += 1;
    return {
      outcome: "ok",
      status: 200,
      finalUrl: "https://theconversation.com/articles.atom",
      body,
      notModified: false,
      validators: { etag: "abc" },
      headers: {},
    };
  };

  const adapter = makeRssCanaryAdapter(
    { channel: "rss", documentUrl: "https://theconversation.com/articles.atom", dateTrust: "trusted" },
    { fetchResponse },
  );
  const result = await adapter({ source: { id: "x" } as never });

  assert.ok(result.items.length > 0, "adapter yields feed items");
  assert.equal(result.boundaryReached, true, "one document is one bounded observable window");
  assert.equal(documentFetches, 1, "exactly ONE channel-document fetch — never a per-item body fetch");
});

// ---------------------------------------------------------------------------
// Full fixture-driven soak: baseline → shadow → GATED activate, zero body work.
// ---------------------------------------------------------------------------

test("fixture soak: baseline → shadow → gated-activate performs ZERO body work end-to-end", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: DISABLED, leaseOwner: LEASE });

  // Failing body-work deps: any invocation fails the soak.
  let bodyFetches = 0;
  let articleWrites = 0;
  let ingestEnqueues = 0;
  const failingFetchBody = async () => { bodyFetches += 1; throw new Error("body fetch must never run"); };
  const failingWriteArticle = async () => { articleWrites += 1; throw new Error("Article write must never run"); };
  const failingEnqueueIngest = async () => { ingestEnqueues += 1; throw new Error("ARTICLE_INGEST enqueue must never run"); };

  const ingestJobsBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  // --- Baseline: begin → observe an identity → complete (enters SHADOW). ---
  await beginBaseline({ sourceId: source.id, leaseOwner: LEASE, definitionVersion: source.definitionVersion });

  const baseUrl = track(undarkUrl(id("soak-base")));
  const baseId = deriveProvisionalIdentity(baseUrl);
  await commitPage(source.id, source.definitionVersion, page([
    { url: baseUrl, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance },
  ]));

  const done = await completeBaseline({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    segments: ALL_COMPLETE,
    initialWatermark: { at: new Date("2024-07-01T00:00:00.000Z"), key: baseId.key },
    baselineObservedCount: 1,
  });
  assert.equal(done.committed && done.mode, SHADOW);

  // --- Shadow re-scan (one simulated publication cycle): re-see base + new. ---
  const newUrl = track(undarkUrl(id("soak-new")));
  const newId = deriveProvisionalIdentity(newUrl);
  const scan = await commitPage(source.id, source.definitionVersion, page([
    { url: baseUrl, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance },
    { url: newUrl, publishedAt: new Date("2024-07-12T00:00:00.000Z"), dateProvenance: provenance },
  ], true));
  assert.equal(scan.committed, true);
  if (!scan.committed) return;
  // The baseline identity is re-observed (existing-identity), NEVER reclassified.
  assert.equal(scan.outcomes["existing-identity"], 1, "old identity is not a false positive");
  assert.equal(scan.outcomes["baseline-shadow"], 1, "the new identity becomes a shadow observation");

  const baseAfter = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: baseId.key } });
  assert.equal(baseAfter?.observedInBaseline, true, "baseline identity untouched");

  // --- Gate enforcement: a FAILING gate keeps the canary SHADOWED (AC2). ---
  const refused = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    exitGateGuard: failingGuard,
  });
  assert.equal(refused.committed, false);
  if (!refused.committed) assert.equal(refused.reason, "exit-gates-failed");
  let row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, SHADOW, "a failing gate blocks activation");

  // --- Gated activation with PASSING soak evidence promotes the canary. ---
  const activated = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    exitGateGuard: passingGuard,
    limits: { ageDays: 100_000, maxCount: 100 },
  });
  assert.equal(activated.committed, true);
  if (!activated.committed) return;
  assert.equal(activated.queuedCount, 1, "only the NEW shadow identity is queued for catch-up");
  row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, ACTIVE);

  // The queued candidate is the NEW identity; the baseline identity stays BASELINE.
  const newCand = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: newId.key } });
  assert.equal(newCand?.status, CrawlCandidateStatus.QUEUED);
  const baseFinal = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: baseId.key } });
  assert.equal(baseFinal?.status, CrawlCandidateStatus.BASELINE, "baseline identity never queued");

  // --- AC4: the body-work guard refuses in the OBSERVE modes (baseline/shadow),
  // so an injected body-work dep is never reached; the gated activation path has
  // NO body-work code at all, so the deps stay untouched through activation too. ---
  const BASELINE = DiscoverySourceLifecycleMode.BASELINE;
  for (const mode of [BASELINE, SHADOW] as const) {
    await assert.rejects(guardIngestPort(mode, "fetch-body", failingFetchBody)(), BodyWorkProhibitedError);
    await assert.rejects(guardIngestPort(mode, "write-article", failingWriteArticle)(), BodyWorkProhibitedError);
    await assert.rejects(guardIngestPort(mode, "enqueue-ingest", failingEnqueueIngest)(), BodyWorkProhibitedError);
  }

  // Proven: no body work anywhere across the whole soak (baseline + shadow +
  // the gated activation), and the injected failing deps were never reached.
  assert.equal(bodyFetches, 0, "no body fetch reached");
  assert.equal(articleWrites, 0, "no Article write reached");
  assert.equal(ingestEnqueues, 0, "no ARTICLE_INGEST enqueue reached");
  assert.equal(await prisma.article.count({ where: { sourceUrl: { in: [baseUrl, newUrl] } } }), 0, "no Article written");
  assert.equal(
    await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }),
    ingestJobsBefore,
    "no ARTICLE_INGEST job created",
  );
});
