process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const longArticleText = Array.from({ length: 40 }, (_, index) => `token${index + 1}`).join(" ");

let discoverImpl: (provider: { key: string }) => Promise<string[]>;
let fetchHtmlImpl: (url: string) => Promise<string>;
let extractArticleImpl: (html: string, url: string) => {
  title: string;
  author: string | null;
  publishedAt: Date | null;
  content: string;
  sourceUrl: string;
  wordCount: number;
  source: string;
  heroImage: string | null;
  excerpt: string | null;
  category: string | null;
  readingMinutes: number;
} | null;
let checkContentQualityImpl: (input: { content: string }) => { grade: "ok" | "warning" | "reject" };

let writes: Array<{ path: string; content: string }> = [];

before(() => {
  mock.module("node:fs", {
    namedExports: {
      writeFileSync: (filePath: string, content: string) => {
        writes.push({ path: filePath, content });
      },
    },
  });

  mock.module("@/lib/scraper/providers/index", {
    namedExports: {
      PROVIDERS: [
        { key: "alpha", seeds: ["https://alpha.example/seed-a", "https://alpha.example/seed-b"] },
        { key: "beta", seeds: ["https://beta.example/seed"] },
      ],
    },
  });

  mock.module("@/lib/scraper/discovery", {
    namedExports: {
      discoverProviderUrls: async (provider: { key: string }) => discoverImpl(provider),
    },
  });

  mock.module("@/lib/scraper/fetch", {
    namedExports: {
      fetchHtml: async (url: string) => fetchHtmlImpl(url),
    },
  });

  mock.module("@/lib/scraper/extract", {
    namedExports: {
      extractArticle: (html: string, url: string) => extractArticleImpl(html, url),
      stripTags: (html: string) => html.replace(/<[^>]+>/g, " "),
    },
  });

  mock.module("@/lib/scraper/quality", {
    namedExports: {
      checkContentQuality: (input: { content: string }) => checkContentQualityImpl(input),
    },
  });

  mock.module("@/lib/scraper/quality-classifier-seed-corpus", {
    namedExports: {
      SEED_ARTICLE_SAMPLES: [
        "Seed article text with enough meaningful words for classifier training input one two three four five six seven.",
      ],
      SEED_AD_SAMPLES: [
        "Seed ad copy with promotional language and offer details for classifier baseline one two three four.",
      ],
    },
  });
});

beforeEach(() => {
  writes = [];
  discoverImpl = async () => ["https://provider.example/article"];
  fetchHtmlImpl = async (url: string) => {
    if (url.includes("seed")) {
      return `
        <a>Top story headline one</a><a>Breaking science report two</a><a>Culture review three</a>
        <a>World update four</a><a>Sports digest five</a><a>Travel guide six</a>
        <a>Health bulletin seven</a><a>Tech analysis eight</a><a>Politics recap nine</a>
      `;
    }
    return `<article>${longArticleText}</article>`;
  };
  extractArticleImpl = (_html, url) => ({
    title: `Title for ${url}`,
    author: "Author",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    content: longArticleText,
    sourceUrl: url,
    wordCount: 40,
    source: "Fixture",
    heroImage: null,
    excerpt: null,
    category: null,
    readingMinutes: 2,
  });
  checkContentQualityImpl = () => ({ grade: "ok" });
});

test("quality corpus helpers normalize excerpts and dedupe samples", async () => {
  const {
    toShortExcerpt,
    pushSample,
    linkDenseFragments,
    syntheticAd,
    buildSyntheticNegatives,
    capHarvestedSamples,
    renderCorpusFile,
  } = await import("../scripts/build-quality-corpus");

  const excerpt = toShortExcerpt(`${longArticleText}. ${longArticleText}. ${longArticleText}.`);
  assert.ok(excerpt.length > 0);
  assert.ok(excerpt.split(/\s+/).length <= 51);

  const output: string[] = [];
  const seen = new Set<string>();
  assert.equal(pushSample(output, seen, longArticleText), true);
  assert.equal(pushSample(output, seen, longArticleText), false);
  assert.equal(pushSample(output, seen, "too short"), false);

  const fragments = linkDenseFragments(
    [
      "one two three",
      "four five six",
      "seven eight nine",
      "ten eleven twelve",
      "thirteen fourteen fifteen",
      "sixteen seventeen eighteen",
      "nineteen twenty twentyone",
      "twentytwo twentythree twentyfour",
    ]
      .map((text) => `<a>${text}</a>`)
      .join(""),
  );
  assert.ok(fragments.length >= 1);

  const synthetic = syntheticAd(3);
  assert.match(synthetic, /\.$/);

  const negatives = buildSyntheticNegatives(4, [
    "Existing negative sample with plenty of classifier words one two three four five six seven eight nine ten eleven twelve.",
  ]);
  assert.equal(negatives.length, 4);

  const capped = capHarvestedSamples(
    Array.from({ length: 300 }, (_, i) => `article sample ${i} with enough words one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty`),
    Array.from({ length: 300 }, (_, i) => `ad sample ${i} with enough words one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty`),
  );
  assert.ok(capped.harvestedArticles.length > 0);
  assert.ok(capped.harvestedAds.length > 0);

  const rendered = renderCorpusFile(["Article sample words one two three four five six seven eight nine ten eleven twelve"], ["Ad sample words one two three four five six seven eight nine ten eleven twelve"]);
  assert.match(rendered, /HARVESTED_ARTICLE_SAMPLES/);
  assert.match(rendered, /HARVESTED_AD_SAMPLES/);
});

test("quality corpus evalGain compares seed-only and expanded classifiers", async () => {
  const { evalGain } = await import("../scripts/build-quality-corpus");

  const harvestedArticles = [
    "Article prose sample about climate science and research with clear narrative structure one two three four five six seven.",
    "Another article sample with educational context and vocabulary practice terms one two three four five six seven eight.",
    "Third article sample containing neutral descriptive language for learners one two three four five six seven eight nine.",
    "Fourth article sample text with sentence variety and coherent topic progression one two three four five six seven.",
    "Fifth article sample discussing travel history and culture in prose form one two three four five six seven.",
  ];
  const harvestedAds = [
    "Ad style copy urging users to subscribe now and claim limited time discount one two three four five six seven.",
    "Promotional message with calls to action and product offers one two three four five six seven eight nine.",
    "Marketing slogan style content focused on urgency and deals one two three four five six seven eight.",
    "Commercial language with repetitive benefits and conversion intent one two three four five six seven eight nine.",
    "Sponsored content snippet with purchase instructions and urgency one two three four five six seven eight.",
  ];

  const result = evalGain(
    harvestedArticles,
    harvestedAds,
    harvestedArticles.slice(0, 2),
    harvestedAds.slice(0, 2),
  );

  assert.ok(Number.isFinite(result.seedAcc));
  assert.ok(Number.isFinite(result.expandedAcc));
  assert.ok(result.testSize > 0);
});

test("quality corpus main harvests samples, handles provider failures, and writes generated corpus", async () => {
  const { main } = await import("../scripts/build-quality-corpus");

  discoverImpl = async (provider) => {
    if (provider.key === "beta") throw new Error("discovery failed");
    return ["https://alpha.example/article-a", "https://alpha.example/article-b"];
  };

  fetchHtmlImpl = async (url: string) => {
    if (url.includes("seed-b")) throw new Error("seed fetch failed");
    if (url.includes("seed")) {
      return `
        <a>one two three four five six seven eight nine ten eleven twelve thirteen fourteen</a>
        <a>fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour</a>
        <a>twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone thirtytwo</a>
      `;
    }
    return `<article>${longArticleText}</article>`;
  };

  extractArticleImpl = (_html, url) => {
    if (url.endsWith("article-b")) return null;
    return {
      title: `Title ${url}`,
      author: "A",
      publishedAt: new Date("2026-03-01T00:00:00.000Z"),
      content: longArticleText,
      sourceUrl: url,
      wordCount: 40,
      source: "Fixture",
      heroImage: null,
      excerpt: null,
      category: null,
      readingMinutes: 2,
    };
  };

  checkContentQualityImpl = ({ content }) =>
    content.includes("token") ? { grade: "ok" } : { grade: "reject" };

  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    await main();
  } finally {
    console.log = originalLog;
  }

  assert.equal(writes.length, 1);
  assert.match(writes[0]?.path ?? "", /quality-classifier-corpus\.ts$/);
  assert.match(writes[0]?.content ?? "", /HARVESTED_ARTICLE_SAMPLES/);
  assert.match(logs.join("\n"), /discovery failed/);
  assert.match(logs.join("\n"), /Next: run scripts\/train-quality-classifier\.ts/);
});
