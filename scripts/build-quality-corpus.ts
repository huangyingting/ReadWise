/**
 * Grows the local Naive-Bayes ad/article quality-classifier training corpus by
 * LIVE-harvesting real, heuristic-labeled scrapes (Issue #739 follow-up).
 *
 * Pipeline:
 *   1. POSITIVES — for each provider, discover a few article URLs, fetch +
 *      `extractArticle`, keep the ones `checkContentQuality` grades `ok`
 *      (long, English, prose) and label them `article`. Each kept sample is
 *      TRUNCATED to ≤ ~50 words (first 1-2 sentences) so NO full article body
 *      is ever committed.
 *   2. NEGATIVES — harvest real boilerplate from provider section/index pages
 *      (link-dense nav/headline lists, cookie/consent banners), plus generic
 *      boilerplate (newsletter / cookie / nav / related) and synthetic ad copy.
 *      Heuristic-label as `ad`. Also truncated to ≤ ~50 words.
 *   3. Resilience — providers that fail live (timeouts / bot blocks) are
 *      skipped; synthetic boilerplate + ad copy fills any gap so the corpus
 *      stays balanced even on a flaky network.
 *   4. Held-out eval — splits the labeled set 80/20 and reports accuracy for the
 *      SEED-ONLY corpus vs. the EXPANDED corpus so the accuracy gain is visible.
 *   5. Writes the regenerated `quality-classifier-corpus.ts`.
 *
 * Run with (live network):
 *   npm run node-ts -- scripts/build-quality-corpus.ts
 *
 * After running, re-run `scripts/train-quality-classifier.ts` to rebuild the
 * committed model JSON from the expanded corpus.
 *
 * @server-only — build-time utility; not imported by app runtime.
 *
 * COPYRIGHT / PRIVACY: only SHORT excerpts of already-public prose and generic
 * boilerplate are written. Never commit full article bodies or user content.
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PROVIDERS } from "@/lib/scraper/providers/index";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { fetchHtml } from "@/lib/scraper/fetch";
import { extractArticle, stripTags } from "@/lib/scraper/extract";
import { checkContentQuality } from "@/lib/scraper/quality";
import {
  SEED_ARTICLE_SAMPLES,
  SEED_AD_SAMPLES,
} from "@/lib/scraper/quality-classifier-seed-corpus";

const require = createRequire(import.meta.url);

// ── Tunables ────────────────────────────────────────────────────────────────
/** URLs to discover per provider. */
const DISCOVER_PER_PROVIDER = 10;
/** Max positive samples to keep per provider (diversity cap). */
const KEEP_PER_PROVIDER = 12;
/** Max words per committed sample (copyright-safe short excerpt). */
const MAX_SAMPLE_WORDS = 50;
/** Min words for a sample to be useful to the classifier. */
const MIN_SAMPLE_WORDS = 22;
/** Target size per class for the expanded corpus (seeds included). */
const TARGET_PER_CLASS = 160;

type Labeled = { text: string; label: "article" | "ad" };

// ── Natural Bayes typing (require-loaded) ───────────────────────────────────
type BayesClassifier = {
  addDocument(text: string, label: string): void;
  train(): void;
  classify(text: string): string;
};
type NaturalModule = { BayesClassifier: new () => BayesClassifier };

// ── Text helpers ────────────────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Truncates `text` to a SHORT excerpt: the first 1-2 sentences, hard-capped at
 * {@link MAX_SAMPLE_WORDS} words. Guarantees no full article body is committed.
 */
function toShortExcerpt(text: string): string {
  const clean = normalizeWhitespace(text);
  if (!clean) return "";

  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  let excerpt = "";
  let used = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    excerpt = excerpt ? `${excerpt} ${sentence}` : sentence;
    used += 1;
    if (wordCount(excerpt) >= MAX_SAMPLE_WORDS || used >= 2) break;
  }

  // Hard word cap regardless of sentence boundaries.
  const words = excerpt.split(/\s+/);
  if (words.length > MAX_SAMPLE_WORDS) {
    excerpt = words.slice(0, MAX_SAMPLE_WORDS).join(" ").replace(/[,;:]$/, "") + "…";
  }
  return excerpt.trim();
}

function dedupeKey(text: string): string {
  return normalizeWhitespace(text).toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

/** Adds `text` to `out` if it is a fresh, well-sized sample. */
function pushSample(out: string[], seen: Set<string>, text: string): boolean {
  const excerpt = toShortExcerpt(text);
  const wc = wordCount(excerpt);
  if (wc < MIN_SAMPLE_WORDS || wc > MAX_SAMPLE_WORDS + 1) return false;
  const key = dedupeKey(excerpt);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  out.push(excerpt);
  return true;
}

// ── Negative harvesting from real section/index pages ───────────────────────

/** Pulls anchor inner-text from a section page (nav / headline link lists). */
function anchorTexts(html: string): string[] {
  const texts: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = normalizeWhitespace(stripTags(m[1] ?? ""));
    if (t.length >= 3 && t.length <= 60) texts.push(t);
  }
  return texts;
}

/**
 * Builds link-dense, non-prose fragments (joined nav/headline anchor text) from
 * a section page. These are exactly the link-list "junk" the scraper down-ranks
 * — short, factual link labels, never creative prose.
 */
function linkDenseFragments(html: string): string[] {
  const anchors = anchorTexts(html);
  const fragments: string[] = [];
  for (let i = 0; i < anchors.length; i += 8) {
    const chunk = anchors.slice(i, i + 8).join(" · ");
    if (wordCount(chunk) >= MIN_SAMPLE_WORDS) fragments.push(chunk);
    if (fragments.length >= 4) break;
  }
  return fragments;
}

// ── Synthetic negative generators (resilient fill) ──────────────────────────

const AD_OPENERS = [
  "Subscribe now",
  "Shop now",
  "Buy today",
  "Sign up today",
  "Order now",
  "Don't miss out",
  "Act fast",
  "Limited time offer",
  "Hurry, sale ends soon",
  "Click here",
  "Save big today",
  "Join now",
];
const AD_BODIES = [
  "and save up to 60% on your first order with free shipping on everything",
  "to unlock exclusive members-only deals, flash sales, and weekly discount codes",
  "and get a free gift while supplies last — this offer expires at midnight",
  "for the best prices of the season on electronics, fashion, and home goods",
  "and enter your email to receive special offers straight to your inbox every day",
  "to claim your coupon, redeem your points, and start saving on every purchase",
  "before stock runs out — lowest prices guaranteed, buy one get one free",
  "and upgrade to premium to remove ads and read without limits, cancel anytime",
  "to win a brand new phone — you are our lucky visitor, confirm your details now",
  "and refinance at historic-low rates, no obligation, check eligibility in minutes",
];
const AD_CLOSERS = [
  "Terms apply.",
  "While supplies last.",
  "Limited stock, hurry.",
  "Use promo code SAVE at checkout.",
  "Free returns, no risk.",
  "Money back guarantee.",
  "Cancel anytime.",
  "No credit card required.",
  "Offer valid today only.",
  "Shop in store or online.",
];

const BOILERPLATE_BLOCKS = [
  "We use cookies and similar technologies to personalize content and ads, provide social media features, and analyze our traffic. By clicking accept you consent to the storing of cookies on your device.",
  "This site uses cookies. We and our partners process data to deliver and measure advertising and content. Accept all, reject all, or manage your cookie preferences in the settings panel.",
  "Sign up for our free newsletter and get the day's top stories delivered to your inbox every morning. Enter your email address below to subscribe. You can unsubscribe at any time.",
  "Subscribe to the newsletter for weekly highlights, exclusive interviews, and behind-the-scenes stories from our editors. Enter your email to join thousands of readers who never miss an update.",
  "Home News World Politics Business Science Health Technology Sports Opinion Culture Travel Weather Video Podcasts Newsletters Login Subscribe Search Menu About Contact Careers Privacy Terms",
  "Skip to main content. Main menu. Search the site. Log in. Register. My account. Saved articles. Settings. Help center. Customer service. Returns and shipping. Contact us. Sitemap.",
  "Related stories: you may also like these articles from around the web. Recommended for you. More from this section. Up next. Most popular. Trending now. Sponsored links. Read more.",
  "Follow us on social media. Like us on Facebook, follow us on Twitter, subscribe on YouTube, and connect on LinkedIn. Share this article with your friends and leave a comment below.",
  "Advertisement. Sponsored content. This post contains affiliate links; as an associate we earn from qualifying purchases. Prices and availability are subject to change without notice.",
  "Your free trial is about to expire. Upgrade to a premium subscription to keep unlimited access to all our articles, archives, and apps. Plans start at a low monthly price, cancel anytime.",
  "Manage consent preferences. Strictly necessary cookies. Performance cookies. Functional cookies. Targeting cookies. Do not sell or share my personal information. Save preferences. Accept all.",
  "Comments are open. Sign in to join the conversation. Be respectful and follow our community guidelines. Report abuse. View all comments. Newest first. Oldest first. Most liked.",
];

function pick<T>(arr: readonly T[], n: number): T {
  return arr[n % arr.length]!;
}

/** Generates a synthetic ad-copy line from rotating templates. */
function syntheticAd(i: number): string {
  const opener = pick(AD_OPENERS, i);
  const body = pick(AD_BODIES, Math.floor(i / AD_OPENERS.length) + i);
  const closer = pick(AD_CLOSERS, i * 3 + 1);
  return `${opener} ${body}. ${closer}`;
}

// ── Deterministic PRNG + shuffle (reproducible eval) ────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ── Held-out 80/20 evaluation ────────────────────────────────────────────────

function trainModel(samples: readonly Labeled[]): BayesClassifier {
  const natural = require("natural") as NaturalModule;
  const clf = new natural.BayesClassifier();
  for (const { text, label } of samples) clf.addDocument(text, label);
  clf.train();
  return clf;
}

function accuracyOn(model: BayesClassifier, test: readonly Labeled[]): number {
  if (test.length === 0) return NaN;
  let correct = 0;
  for (const { text, label } of test) {
    if (model.classify(text) === label) correct += 1;
  }
  return correct / test.length;
}

/**
 * Fair accuracy-gain measurement. The held-out 20% test set is drawn from the
 * REALISTIC harvested samples only (the distribution we actually care about).
 * Both models are scored on that SAME test set:
 *   - seed-only  : trained on the hand-curated seeds alone.
 *   - expanded   : trained on the seeds plus the remaining 80% of harvested.
 * This isolates the value of the harvested training data instead of comparing
 * each model against its own (different, easier/harder) held-out split.
 */
function evalGain(
  harvestedArticles: readonly string[],
  harvestedAds: readonly string[],
  seedArticles: readonly string[],
  seedAds: readonly string[],
): { seedAcc: number; expandedAcc: number; testSize: number } {
  const harvested: Labeled[] = [
    ...harvestedArticles.map((text) => ({ text, label: "article" as const })),
    ...harvestedAds.map((text) => ({ text, label: "ad" as const })),
  ];
  const pool = shuffled(harvested, 0x5eed);
  const testN = Math.floor(pool.length * 0.2);
  const test = pool.slice(0, testN);
  const trainHarvested = pool.slice(testN);

  const seedSamples: Labeled[] = [
    ...seedArticles.map((text) => ({ text, label: "article" as const })),
    ...seedAds.map((text) => ({ text, label: "ad" as const })),
  ];

  const seedModel = trainModel(seedSamples);
  const expandedModel = trainModel([...seedSamples, ...trainHarvested]);

  return {
    seedAcc: accuracyOn(seedModel, test),
    expandedAcc: accuracyOn(expandedModel, test),
    testSize: test.length,
  };
}

// ── Live harvesting ──────────────────────────────────────────────────────────

async function harvestPositives(): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const provider of PROVIDERS) {
    let kept = 0;
    try {
      const urls = await discoverProviderUrls(provider, DISCOVER_PER_PROVIDER, {
        isProviderEnabled: async () => true,
        isUrlAllowed: async () => true,
      });
      for (const url of urls) {
        if (kept >= KEEP_PER_PROVIDER) break;
        try {
          const html = await fetchHtml(url);
          const article = extractArticle(html, url);
          if (!article) continue;
          const quality = checkContentQuality({
            title: article.title,
            author: article.author,
            publishedAt: article.publishedAt,
            content: article.content,
            wordCount: article.wordCount,
            sourceUrl: article.sourceUrl,
          });
          if (quality.grade !== "ok") continue;
          const bodyText = stripTags(article.content);
          if (pushSample(out, seen, bodyText)) kept += 1;
        } catch {
          // Single-URL failure (timeout / block / parse) — skip and continue.
        }
      }
      console.log(`  [+] ${provider.key}: kept ${kept} article excerpt(s)`);
    } catch (err) {
      console.log(
        `  [!] ${provider.key}: discovery failed (${err instanceof Error ? err.message : String(err)}) — skipped`,
      );
    }
  }
  return out;
}

async function harvestRealNegatives(): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const provider of PROVIDERS) {
    for (const seed of provider.seeds.slice(0, 2)) {
      try {
        const html = await fetchHtml(seed);
        for (const fragment of linkDenseFragments(html)) {
          pushSample(out, seen, fragment);
        }
      } catch {
        // Section page failed to fetch — fine, synthetic fill covers it.
      }
    }
    console.log(`  [+] ${provider.key}: ${out.length} link-dense negative(s) so far`);
  }
  return out;
}

function buildSyntheticNegatives(target: number, existing: string[]): string[] {
  const out = existing.slice();
  const seen = new Set(out.map(dedupeKey));

  for (const block of BOILERPLATE_BLOCKS) {
    if (out.length >= target) break;
    pushSample(out, seen, block);
  }
  for (let i = 0; out.length < target && i < target * 4; i++) {
    pushSample(out, seen, syntheticAd(i));
  }
  return out;
}

// ── Corpus file generation ───────────────────────────────────────────────────

function literalArray(samples: readonly string[]): string {
  if (samples.length === 0) return "[]";
  const lines = samples.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  return `[\n${lines}\n]`;
}

function renderCorpusFile(articles: readonly string[], ads: readonly string[]): string {
  return `/**
 * Training corpus for the local Naive-Bayes ad/article quality classifier
 * (Issue #739 follow-up).
 *
 * GENERATED FILE — the \`HARVESTED_*\` arrays below are produced by
 * \`scripts/build-quality-corpus.ts\`, which live-harvests real, heuristic-labeled
 * scrapes (positives graded \`ok\` by \`checkContentQuality\`) and real/synthetic
 * boilerplate + ad copy (negatives). Re-run the builder to regenerate, then
 * re-run \`scripts/train-quality-classifier.ts\` to rebuild the model JSON.
 *
 * The hand-curated SEED samples are imported from
 * \`quality-classifier-seed-corpus.ts\` and are always preserved. Edit seeds
 * there; do NOT hand-edit the harvested arrays here (they are overwritten).
 *
 * @server-only — only consumed by the training script and the (server-only)
 * classifier module.
 *
 * COPYRIGHT / PRIVACY: harvested positives are SHORT excerpts only (truncated to
 * \u2264 ~50 words / first 1-2 sentences) of already-public article prose \u2014 never
 * full article bodies. Negatives are generic, non-creative boilerplate
 * (newsletter / cookie / nav / related blocks) and synthetic ad copy. No
 * user-private content is ever stored here.
 */

import {
  SEED_ARTICLE_SAMPLES,
  SEED_AD_SAMPLES,
} from "@/lib/scraper/quality-classifier-seed-corpus";

/** Live-harvested article-prose excerpts (SHORT, \u2264 ~50 words each). */
export const HARVESTED_ARTICLE_SAMPLES: readonly string[] = ${literalArray(articles)};

/** Harvested + synthetic boilerplate / ad-copy negatives (SHORT). */
export const HARVESTED_AD_SAMPLES: readonly string[] = ${literalArray(ads)};

/** Genuine article prose samples (seed + harvested). */
export const ARTICLE_SAMPLES: readonly string[] = [
  ...SEED_ARTICLE_SAMPLES,
  ...HARVESTED_ARTICLE_SAMPLES,
];

/** Ad / junk / navigation / boilerplate samples (seed + harvested). */
export const AD_SAMPLES: readonly string[] = [...SEED_AD_SAMPLES, ...HARVESTED_AD_SAMPLES];
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Harvesting POSITIVES (live article scrapes)…");
  const positives = await harvestPositives();
  console.log(`  → ${positives.length} unique article excerpts kept\n`);

  console.log("Harvesting NEGATIVES (real section-page boilerplate)…");
  const realNegatives = await harvestRealNegatives();
  console.log(`  → ${realNegatives.length} real link-dense negatives\n`);

  console.log("Filling NEGATIVES with synthetic boilerplate + ad copy…");
  const negativeTarget = Math.max(positives.length + SEED_ARTICLE_SAMPLES.length, TARGET_PER_CLASS) -
    SEED_AD_SAMPLES.length;
  const negatives = buildSyntheticNegatives(Math.max(negativeTarget, 0), realNegatives);
  console.log(`  → ${negatives.length} total harvested+synthetic negatives\n`);

  // Cap each harvested class so the committed file stays reasonable in size.
  const cap = Math.max(0, TARGET_PER_CLASS - SEED_ARTICLE_SAMPLES.length);
  const harvestedArticles = positives.slice(0, cap);
  const harvestedAds = negatives.slice(0, Math.max(0, TARGET_PER_CLASS - SEED_AD_SAMPLES.length));

  const expandedArticles = [...SEED_ARTICLE_SAMPLES, ...harvestedArticles];
  const expandedAds = [...SEED_AD_SAMPLES, ...harvestedAds];

  // ── Held-out accuracy: seed-only vs. expanded (same realistic test set) ──
  console.log("Evaluating held-out accuracy (80/20 on harvested test set)…");
  const { seedAcc, expandedAcc, testSize } = evalGain(
    harvestedArticles,
    harvestedAds,
    SEED_ARTICLE_SAMPLES,
    SEED_AD_SAMPLES,
  );

  // ── Write corpus file ──
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(here, "../src/lib/scraper/quality-classifier-corpus.ts");
  writeFileSync(outPath, renderCorpusFile(harvestedArticles, harvestedAds), "utf8");

  console.log("\n──────────────────────────────────────────────");
  console.log("CORPUS SIZE (article / ad):");
  console.log(`  seed-only : ${SEED_ARTICLE_SAMPLES.length} / ${SEED_AD_SAMPLES.length}`);
  console.log(`  expanded  : ${expandedArticles.length} / ${expandedAds.length}`);
  console.log("HELD-OUT ACCURACY (80/20 on harvested test set):");
  console.log(`  test samples : ${testSize}`);
  console.log(`  seed-only    : ${(seedAcc * 100).toFixed(1)}%`);
  console.log(`  expanded     : ${(expandedAcc * 100).toFixed(1)}%`);
  console.log(`Wrote: ${outPath}`);
  console.log("Next: run scripts/train-quality-classifier.ts to rebuild the model JSON.");
  console.log("──────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("build-quality-corpus failed:", err);
  process.exit(1);
});
