/**
 * Production force-rescrape body-fetch preparer (#1129) — the real implementation
 * of the `PrepareRescrapeDraft` seam (#1102) that until now failed CLOSED.
 *
 * It COMPOSES existing production building blocks behind ONE impure boundary:
 *   fetch (SSRF-safe) → extract → quality gate → safety (moderation) → canonical
 * identity resolution (#1092). The runner calls it reads-before-tx; it MUST NOT
 * open a transaction, mutate the Article, or run AI beyond moderation. A read-only
 * Prisma lookup (the blocked/quarantined-identity probe) is permitted.
 *
 * Every building block is an INJECTABLE seam that DEFAULTS to the real production
 * function, so the preparer is fully unit-testable with fakes and needs NO network
 * or database in tests (mirrors `createAnnotationMigrator`).
 *
 * MODULE BOUNDARY: `src/lib/scraper/*` may NOT import `@/lib/content-pipeline`
 * (one-way ownership boundary — see `tests/scraper-content-boundaries.test.ts`).
 * The Reader derives its plain text with `articleHtmlToReaderText`; that is
 * therefore INJECTED as `deriveReaderText` (the admin route supplies the real
 * implementation, the module default is the in-boundary `stripTags`), so the
 * moderation verdict is computed over the SAME reader text the product shows.
 *
 * PRIVACY (AGENTS.md hard rule): the fetched body/title/URL/excerpt are returned
 * STRAIGHT to the runner (which writes them only to the `ArticleContentVersion`
 * row). They are NEVER logged. Every log line here carries ids + booleans + small
 * enums only — never content, a title, a URL, or a secret.
 */
import { CanonicalConflictStatus, CrawlCandidateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { moderateText } from "@/lib/ai/output/moderation";
import { fetchHtml } from "@/lib/scraper/fetch";
import { extractArticle, stripTags } from "@/lib/scraper/extract";
import {
  checkContentQuality,
  type ContentQualityResult,
  type QualityInput,
} from "@/lib/scraper/quality";
import { providerForUrl } from "@/lib/scraper/providers";
import { deriveCanonicalIdentity } from "@/lib/scraper/url-identity";
import type { ScrapedArticle } from "@/lib/scraper/types";

import { resolveFinalIdentity, type FinalIdentityResolution } from "./final-identity";
import type { RescrapeContentPayload } from "./force-rescrape-commit";
import type {
  RescrapeCanonicalSignal,
  RescrapeQualitySignal,
  RescrapeSafetySignal,
  RescrapeValidationSignals,
} from "./force-rescrape-policy";
import type {
  PrepareRescrapeContext,
  PrepareRescrapeDraft,
  PreparedRescrape,
} from "./force-rescrape-runner";

const log = createLogger("rescrape-preparer");

/** The single fail-closed verdict — the fetch/extract could not obtain a body. */
const FETCH_FAILURE: PreparedRescrape = { kind: "fetch-failure", reason: "fetch_failed" };

/** The Article identity the preparer refetches (never its stored content). */
type RescrapeArticleRef = PrepareRescrapeContext["article"];

/** A minimal moderation verdict — only the boolean is consumed. */
export type ModerationVerdict = { flagged: boolean };

/**
 * Reads whether a resolved canonical identity is currently BLOCKED — i.e. it is
 * quarantined or has an OPEN canonical conflict. Read-only (no tx/mutation). The
 * identity is a SANITIZED `(providerKey, canonicalKey)` hash pair, never a URL.
 */
export type LookupIdentityBlocked = (identity: {
  providerKey: string;
  canonicalKey: string;
}) => Promise<boolean>;

/** Resolves the refreshed page's canonical verdict vs the Article's owned identity. */
export type ResolveRescrapeCanonical = (args: {
  article: RescrapeArticleRef;
  html: string;
}) => Promise<RescrapeCanonicalSignal>;

/** Injectable production seams — each defaults to the real production function. */
export type RescrapePreparerDeps = {
  /** SSRF-safe fetch of the Article's `sourceUrl`. Default: {@link fetchHtml}. */
  fetchHtml?: (url: string, timeoutMs?: number) => Promise<string>;
  /** HTML → normalized article. Default: {@link extractArticle}. */
  extract?: (html: string, sourceUrl: string) => ScrapedArticle | null;
  /** Deterministic quality gate. Default: {@link checkContentQuality}. */
  qualityGate?: (article: QualityInput) => ContentQualityResult;
  /** Heuristic free-text moderation. Default: {@link moderateText}. */
  moderate?: (text: string) => ModerationVerdict;
  /** HTML → Reader plain text for moderation. Default (in-boundary): {@link stripTags}. */
  deriveReaderText?: (content: string) => string;
  /** Canonical-identity resolver. Default: {@link resolveRescrapeCanonicalSignal}. */
  resolveCanonical?: ResolveRescrapeCanonical;
  /** Optional fetch timeout override (ms). */
  timeoutMs?: number;
};

/**
 * PURE mapping from a resolved final identity + the owned identity key + a
 * blocked flag to the canonical signal the activation policy consumes. Fails
 * CLOSED: only a `keep-own-provider` resolution whose key MATCHES the Article's
 * owned identity (and is not blocked) yields `"match"`; every other shape —
 * transfer, route-to-review, a different key, or a blocked identity — is a
 * `"conflict"`/`"blocked"` that retains the current version.
 */
export function classifyCanonicalResolution(args: {
  resolution: FinalIdentityResolution;
  ownedKey: string | null;
  blocked: boolean;
}): RescrapeCanonicalSignal {
  const { resolution, ownedKey, blocked } = args;
  if (resolution.decision !== "keep-own-provider") return "conflict";
  if (!ownedKey || resolution.identity.key !== ownedKey) return "conflict";
  return blocked ? "blocked" : "match";
}

const CANONICAL_LINK_RE =
  /<link\b[^>]*\brel\s*=\s*["']?\s*canonical\s*["']?[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i;
const CANONICAL_LINK_HREF_FIRST_RE =
  /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']?\s*canonical\s*["']?[^>]*>/i;

/**
 * PURE extraction of the declared `<link rel="canonical" href="…">` from HTML,
 * tolerating either attribute order. Returns the raw href (trimmed) or `null`.
 */
export function parseCanonicalLink(html: string): string | null {
  const match = html.match(CANONICAL_LINK_RE) ?? html.match(CANONICAL_LINK_HREF_FIRST_RE);
  const href = match?.[1]?.trim();
  return href && href.length > 0 ? href : null;
}

/**
 * PRODUCTION blocked-identity probe: an identity is BLOCKED when a quarantined
 * candidate claims it OR an OPEN canonical conflict contests it. Read-only.
 */
const productionLookupIdentityBlocked: LookupIdentityBlocked = async ({ providerKey, canonicalKey }) => {
  const [quarantined, conflict] = await Promise.all([
    prisma.crawlCandidate.findFirst({
      where: { providerKey, canonicalKey, status: CrawlCandidateStatus.QUARANTINED },
      select: { id: true },
    }),
    prisma.canonicalConflict.findFirst({
      where: { providerKey, canonicalKey, status: CanonicalConflictStatus.OPEN },
      select: { id: true },
    }),
  ]);
  return Boolean(quarantined || conflict);
};

/**
 * PRODUCTION canonical resolver (the default `resolveCanonical` seam). Resolves
 * the refreshed page's canonical identity with the SAME pure #1092 resolver the
 * ingest path uses and compares it to the Article's CURRENT owned identity,
 * mirroring `applyFinalIdentity`. Fails CLOSED to `"conflict"` whenever ownership
 * or the identity cannot be established — the Article's identity is sacred.
 */
export async function resolveRescrapeCanonicalSignal(
  article: RescrapeArticleRef,
  html: string,
  lookupIdentityBlocked: LookupIdentityBlocked = productionLookupIdentityBlocked,
): Promise<RescrapeCanonicalSignal> {
  const owningProviderKey =
    providerForUrl(article.sourceUrl)?.key ??
    (article.canonicalUrl ? providerForUrl(article.canonicalUrl)?.key ?? null : null);
  if (!owningProviderKey) return "conflict";

  let ownedKey: string | null;
  try {
    ownedKey = deriveCanonicalIdentity(article.canonicalUrl ?? article.sourceUrl, {
      owningProviderKey,
    }).key;
  } catch {
    return "conflict";
  }

  const resolution = resolveFinalIdentity({
    owningProviderKey,
    finalUrl: article.sourceUrl,
    canonicalUrl: parseCanonicalLink(html),
  });

  // Only a same-provider, same-key resolution can be a match — so the blocked
  // probe (a DB read) runs ONLY on that path, never on an already-conflict one.
  let blocked = false;
  if (resolution.decision === "keep-own-provider" && resolution.identity.key === ownedKey) {
    blocked = await lookupIdentityBlocked({
      providerKey: resolution.identity.providerKey ?? owningProviderKey,
      canonicalKey: resolution.identity.key,
    });
  }
  return classifyCanonicalResolution({ resolution, ownedKey, blocked });
}

/** Maps an extracted article to the version-row content payload (provenance kept). */
function toContentPayload(
  extracted: ScrapedArticle,
  canonicalUrl: string | null,
): RescrapeContentPayload {
  return {
    content: extracted.content,
    title: extracted.title,
    excerpt: extracted.excerpt,
    author: extracted.author,
    heroImage: extracted.heroImage,
    source: extracted.source,
    category: extracted.category,
    wordCount: extracted.wordCount,
    readingMinutes: extracted.readingMinutes,
    sourceUrl: extracted.sourceUrl,
    canonicalUrl,
    publishedAt: extracted.publishedAt,
  };
}

/**
 * Builds the PRODUCTION {@link PrepareRescrapeDraft} by composing the injected
 * seams. Returns `{ kind: "prepared", content, signals }` on success or the
 * fail-closed `{ kind: "fetch-failure", reason: "fetch_failed" }` when the fetch
 * or extraction cannot obtain a usable replacement body. Never throws for a
 * fetch/extract failure — it is converted to the controlled fetch-failure verdict.
 */
export function createProductionRescrapePreparer(
  deps: RescrapePreparerDeps = {},
): PrepareRescrapeDraft {
  const fetchHtmlFn = deps.fetchHtml ?? fetchHtml;
  const extract = deps.extract ?? extractArticle;
  const qualityGate = deps.qualityGate ?? checkContentQuality;
  const moderate = deps.moderate ?? moderateText;
  const deriveReaderText = deps.deriveReaderText ?? stripTags;
  const resolveCanonical =
    deps.resolveCanonical ??
    ((args: { article: RescrapeArticleRef; html: string }) =>
      resolveRescrapeCanonicalSignal(args.article, args.html));

  return async (ctx: PrepareRescrapeContext): Promise<PreparedRescrape> => {
    const { article } = ctx;

    let html: string;
    try {
      html =
        deps.timeoutMs != null
          ? await fetchHtmlFn(article.sourceUrl, deps.timeoutMs)
          : await fetchHtmlFn(article.sourceUrl);
    } catch {
      log.info("force-rescrape prepare: fetch failed", { articleId: article.id });
      return FETCH_FAILURE;
    }

    const extracted = extract(html, article.sourceUrl);
    if (!extracted || extracted.content.trim().length === 0) {
      log.info("force-rescrape prepare: no usable body", { articleId: article.id });
      return FETCH_FAILURE;
    }

    const quality: RescrapeQualitySignal =
      qualityGate(extracted).grade === "reject" ? "reject" : "pass";
    const safety: RescrapeSafetySignal = moderate(deriveReaderText(extracted.content)).flagged
      ? "unsafe"
      : "safe";

    let canonical: RescrapeCanonicalSignal;
    try {
      canonical = await resolveCanonical({ article, html });
    } catch {
      canonical = "conflict";
    }

    const signals: RescrapeValidationSignals = { bodyPresent: true, canonical, safety, quality };
    log.info("force-rescrape prepare: complete", {
      articleId: article.id,
      bodyPresent: true,
      canonical,
      safety,
      quality,
    });
    return {
      kind: "prepared",
      content: toContentPayload(extracted, parseCanonicalLink(html)),
      signals,
    };
  };
}
