/**
 * Discovery baseline seed integration tests (#1083, Phase 1.3).
 *
 * Engine-agnostic like `discovery-ledger.test.ts`: runs on SQLite by default
 * under `npm run test:db`, PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). They exercise the real `backfillDiscoveryBaseline`
 * against the live database: eligible-row selection, unique-identity seeding
 * with the governing no-reingestion guarantee, conflict isolation, private-copy
 * safety, idempotent reruns, and the write-free dry-run/report mode.
 *
 * Backfill rows carry REAL provider keys (e.g. "undark") derived from each
 * Article's sourceUrl, so the shared PREFIX sweep cannot reach them; a local
 * afterEach deletes the exact identity keys produced by these tests.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ArticleSourceType,
  ArticleVisibility,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  BASELINE_CONFLICT_REASON,
  BASELINE_TERMINAL_REASON,
  backfillDiscoveryBaseline,
} from "@/lib/scraper/incremental/baseline-backfill";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

// Identity keys produced by this suite. Backfill writes them under the real
// provider key, so the shared PREFIX sweep cannot remove them.
const createdIdentityKeys = new Set<string>();
// Article IDs created per test, used to scope the backfill so it never touches
// unrelated (real) eligible Articles already present in the database.
let createdArticleIds: string[] = [];

afterEach(async () => {
  if (!enabled) return;
  const keys = [...createdIdentityKeys];
  if (keys.length > 0) {
    // Deleting candidates cascades their aliases; conflicts are removed by key.
    await prisma.crawlCandidate.deleteMany({ where: { provisionalKey: { in: keys } } });
    await prisma.urlAlias.deleteMany({ where: { aliasKey: { in: keys } } });
    await prisma.canonicalConflict.deleteMany({ where: { canonicalKey: { in: keys } } });
  }
  createdIdentityKeys.clear();
  createdArticleIds = [];
});

/** A unique undark.org article URL for this run (real provider → non-null key). */
function articleUrl(token: string, query = ""): string {
  return `https://undark.org/2024/01/02/${token}-story/${query}`;
}

type CreateArticleOptions = {
  sourceUrl: string | null;
  visibility?: ArticleVisibility;
  sourceType?: ArticleSourceType;
  ownerId?: string | null;
};

async function createArticle(options: CreateArticleOptions): Promise<string> {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Baseline seed fixture",
      content: "Representative body for baseline-seed tests.",
      status: "PUBLISHED",
      visibility: options.visibility ?? ArticleVisibility.PUBLIC,
      sourceType: options.sourceType ?? ArticleSourceType.SCRAPED,
      ownerId: options.ownerId ?? null,
      sourceUrl: options.sourceUrl,
      publishedAt: new Date(),
    },
  });
  if (options.sourceUrl) {
    try {
      createdIdentityKeys.add(deriveProvisionalIdentity(options.sourceUrl).key);
    } catch {
      // Unparseable URLs never produce a key; nothing to clean up.
    }
  }
  createdArticleIds.push(articleId);
  return articleId;
}

/** Scopes the backfill to Articles created by the current test. */
function scope(dryRun = false) {
  return { dryRun, articleIds: [...createdArticleIds] };
}

async function createUser(): Promise<string> {
  const userId = id("user");
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.com` } });
  return userId;
}

test("no-conflict: each eligible Article gets one baseline candidate + provisional alias", { skip: !enabled }, async () => {
  const urlA = articleUrl("alpha");
  const urlB = articleUrl("beta");
  const articleA = await createArticle({ sourceUrl: urlA });
  const articleB = await createArticle({ sourceUrl: urlB });

  const report = await backfillDiscoveryBaseline(scope());

  assert.equal(report.candidatesCreated, 2);
  assert.equal(report.aliasesCreated, 2);
  assert.equal(report.conflicts, 0);

  for (const [articleId, url] of [
    [articleA, urlA],
    [articleB, urlB],
  ] as const) {
    const identity = deriveProvisionalIdentity(url);
    const candidate = await prisma.crawlCandidate.findUnique({
      where: {
        providerKey_identityVersion_provisionalKey: {
          providerKey: "undark",
          identityVersion: 1,
          provisionalKey: identity.key,
        },
      },
    });
    assert.ok(candidate, "a candidate exists for the eligible Article");
    assert.equal(candidate?.articleId, articleId);
    assert.equal(candidate?.observedInBaseline, true, "governing invariant flag is set");
    assert.equal(candidate?.status, CrawlCandidateStatus.INGESTED);
    assert.ok(candidate?.ingestedAt, "ingestion history is recorded");
    assert.equal(candidate?.terminalReason, BASELINE_TERMINAL_REASON);
    assert.equal(candidate?.canonicalKey, null, "no page canonical is inferred");

    const alias = await prisma.urlAlias.findUnique({
      where: {
        providerKey_identityVersion_aliasKey: {
          providerKey: "undark",
          identityVersion: 1,
          aliasKey: identity.key,
        },
      },
    });
    assert.ok(alias, "a provisional alias exists");
    assert.equal(alias?.kind, UrlAliasKind.PROVISIONAL);
    assert.equal(alias?.candidateId, candidate?.id);
  }
});

test("conflict: two Articles normalizing to one identity produce one open conflict and no candidates", { skip: !enabled }, async () => {
  const canonical = articleUrl("gamma");
  const tracked = articleUrl("gamma", "?utm_source=newsletter");
  const conflictA = await createArticle({ sourceUrl: canonical });
  const conflictB = await createArticle({ sourceUrl: tracked });
  // An unrelated identity must be unaffected by the conflict.
  const soloUrl = articleUrl("solo");
  const solo = await createArticle({ sourceUrl: soloUrl });

  const report = await backfillDiscoveryBaseline(scope());

  assert.equal(report.conflicts, 1);
  assert.equal(report.conflictsCreated, 1);
  assert.equal(report.conflictedArticles, 2);
  assert.equal(report.candidatesCreated, 1, "only the unrelated identity is seeded");

  const identity = deriveProvisionalIdentity(canonical);
  const conflict = await prisma.canonicalConflict.findUnique({
    where: {
      providerKey_identityVersion_canonicalKey: {
        providerKey: "undark",
        identityVersion: 1,
        canonicalKey: identity.key,
      },
    },
  });
  assert.ok(conflict, "a conflict is recorded for the contested identity");
  assert.equal(conflict?.status, CanonicalConflictStatus.OPEN);
  assert.equal(conflict?.reason, BASELINE_CONFLICT_REASON);

  // No candidate is created for the contested identity (fail closed).
  assert.equal(
    await prisma.crawlCandidate.count({ where: { provisionalKey: identity.key } }),
    0,
    "contested identity is left unset",
  );

  // The unrelated identity proceeds normally.
  const soloIdentity = deriveProvisionalIdentity(soloUrl);
  assert.equal(
    await prisma.crawlCandidate.count({ where: { provisionalKey: soloIdentity.key } }),
    1,
    "unrelated identity is seeded despite the conflict",
  );

  // The conflict report is metadata only: Article IDs + controlled reason.
  assert.equal(report.conflictDetails.length, 1);
  assert.equal(report.conflictDetails[0].reason, BASELINE_CONFLICT_REASON);
  assert.deepEqual([...report.conflictDetails[0].articleIds].sort(), [conflictA, conflictB].sort());
  assert.ok(!("sourceUrl" in report.conflictDetails[0]), "no URL is present in the report");
  assert.ok(solo, "solo article was created");
});

test("missing sourceUrl: eligible Article is skipped and reported, never given an identity", { skip: !enabled }, async () => {
  const withUrl = await createArticle({ sourceUrl: articleUrl("has-url") });
  const noUrl = await createArticle({ sourceUrl: null });

  const report = await backfillDiscoveryBaseline(scope());

  assert.equal(report.candidatesCreated, 1);
  const skip = report.skipped.find((entry) => entry.articleId === noUrl);
  assert.ok(skip, "the null-sourceUrl Article is reported as skipped");
  assert.equal(skip?.reason, "missing-source-url");
  assert.ok(withUrl, "the article with a URL was created");
});

test("private copy: a PRIVATE Article sharing a sourceUrl never occupies the public identity", { skip: !enabled }, async () => {
  const sharedUrl = articleUrl("shared");
  const publicArticle = await createArticle({ sourceUrl: sharedUrl });

  const owner = await createUser();
  const privateArticle = await createArticle({
    sourceUrl: sharedUrl,
    ownerId: owner,
    visibility: ArticleVisibility.PRIVATE,
  });

  const report = await backfillDiscoveryBaseline(scope());

  // Exactly one candidate (for the public Article); the private copy is excluded.
  assert.equal(report.candidatesCreated, 1);
  assert.equal(report.conflicts, 0, "a private + public pair is not a conflict");

  const identity = deriveProvisionalIdentity(sharedUrl);
  const candidate = await prisma.crawlCandidate.findUnique({
    where: {
      providerKey_identityVersion_provisionalKey: {
        providerKey: "undark",
        identityVersion: 1,
        provisionalKey: identity.key,
      },
    },
  });
  assert.equal(candidate?.articleId, publicArticle, "the public Article owns the identity");
  assert.notEqual(candidate?.articleId, privateArticle, "the private copy never occupies it");

  // Both Articles remain valid and distinct (Article @@unique([sourceUrl, ownerId])).
  assert.equal(await prisma.article.count({ where: { sourceUrl: sharedUrl } }), 2);
});

test("idempotent: running twice converges with identical counts and no duplicate rows", { skip: !enabled }, async () => {
  await createArticle({ sourceUrl: articleUrl("rerun-one") });
  await createArticle({ sourceUrl: articleUrl("rerun-two") });
  // A conflict identity to prove conflict idempotency too.
  await createArticle({ sourceUrl: articleUrl("rerun-dupe") });
  await createArticle({ sourceUrl: articleUrl("rerun-dupe", "?utm_source=x") });

  const first = await backfillDiscoveryBaseline(scope());
  assert.equal(first.candidatesCreated, 2);
  assert.equal(first.aliasesCreated, 2);
  assert.equal(first.conflictsCreated, 1);

  const candidatesAfterFirst = await prisma.crawlCandidate.count({
    where: { provisionalKey: { in: [...createdIdentityKeys] } },
  });
  const aliasesAfterFirst = await prisma.urlAlias.count({
    where: { aliasKey: { in: [...createdIdentityKeys] } },
  });
  const conflictsAfterFirst = await prisma.canonicalConflict.count({
    where: { canonicalKey: { in: [...createdIdentityKeys] } },
  });

  const second = await backfillDiscoveryBaseline(scope());
  // The rerun creates nothing new; every identity is already present.
  assert.equal(second.candidatesCreated, 0);
  assert.equal(second.candidatesExisting, 2);
  assert.equal(second.aliasesCreated, 0);
  assert.equal(second.aliasesExisting, 2);
  assert.equal(second.conflictsCreated, 0);
  assert.equal(second.conflictsExisting, 1);

  assert.equal(
    await prisma.crawlCandidate.count({ where: { provisionalKey: { in: [...createdIdentityKeys] } } }),
    candidatesAfterFirst,
    "no duplicate candidates after rerun",
  );
  assert.equal(
    await prisma.urlAlias.count({ where: { aliasKey: { in: [...createdIdentityKeys] } } }),
    aliasesAfterFirst,
    "no duplicate aliases after rerun",
  );
  assert.equal(
    await prisma.canonicalConflict.count({ where: { canonicalKey: { in: [...createdIdentityKeys] } } }),
    conflictsAfterFirst,
    "no duplicate conflicts after rerun",
  );
});

test("dry-run: report mode performs zero writes", { skip: !enabled }, async () => {
  await createArticle({ sourceUrl: articleUrl("dry-one") });
  await createArticle({ sourceUrl: articleUrl("dry-dupe") });
  await createArticle({ sourceUrl: articleUrl("dry-dupe", "?utm_source=x") });

  const report = await backfillDiscoveryBaseline(scope(true));

  // The report describes what WOULD happen...
  assert.equal(report.dryRun, true);
  assert.equal(report.candidatesCreated, 1);
  assert.equal(report.aliasesCreated, 1);
  assert.equal(report.conflictsCreated, 1);

  // ...but nothing is persisted.
  const keys = [...createdIdentityKeys];
  assert.equal(await prisma.crawlCandidate.count({ where: { provisionalKey: { in: keys } } }), 0);
  assert.equal(await prisma.urlAlias.count({ where: { aliasKey: { in: keys } } }), 0);
  assert.equal(await prisma.canonicalConflict.count({ where: { canonicalKey: { in: keys } } }), 0);
});
