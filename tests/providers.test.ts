/**
 * Tests for provider registration and category mapping (Issue #118).
 * Verifies: providers are registered, articleUrlPatterns match expected paths,
 * categoryFor maps topic paths to canonical CATEGORY_SLUGS, and the shared
 * mapSectionToCategory keyword mapper routes sections correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, getProvider, getProviderByName, mapSectionToCategory, providerReadingCategories, isProviderCategoryReadingSuitable } from "@/lib/scraper/providers";
import { CATEGORY_SLUGS, isReadingRecommended } from "@/lib/categories";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CategoryCase = readonly [section: string, category: string | null];
type ProviderUrlCase = readonly [providerKey: string, url: string];

const SOURCE_DERIVED_PROVIDER_KEYS = [
  "bbcfeatures",
  "theconversation",
  "propublica",
  "smithsonian",
  "knowable",
  "nautilus",
  "technologyreview",
  "noema",
  "undark",
  "atlasobscura",
  "jstordaily",
  "hakaimagazine",
  "yalee360",
  "worksinprogress",
] as const;

const LONG_FORM_PROVIDER_KEYS = [
  "natgeo",
  "smithsonian",
  "knowable",
  "nautilus",
  "technologyreview",
  "noema",
  "undark",
  "theconversation",
  "propublica",
  "bbcfeatures",
  "atlasobscura",
  "jstordaily",
  "hakaimagazine",
  "yalee360",
  "worksinprogress",
] as const;

const NEWS_LEARNING_PROVIDER_KEYS = ["time", "huffpost"] as const;

function getProviderOrFail(key: string) {
  const provider = getProvider(key);
  assert.ok(provider, `Provider "${key}" must be registered`);
  return provider!;
}

function assertSectionCategories(cases: ReadonlyArray<CategoryCase>) {
  for (const [section, category] of cases) {
    assert.equal(mapSectionToCategory(section), category, `"${section}" should map to ${category}`);
  }
}

function assertProviderUrlPatterns(cases: ReadonlyArray<ProviderUrlCase>) {
  for (const [providerKey, url] of cases) {
    assert.ok(getProviderOrFail(providerKey).articleUrlPattern.test(url), `${providerKey} should match ${url}`);
  }
}

// ---------------------------------------------------------------------------
// General provider registry
// ---------------------------------------------------------------------------

test("all providers have keys with valid category slugs as defaults", () => {
  for (const p of PROVIDERS) {
    assert.ok(
      p.defaultCategory !== null && CATEGORY_SLUGS.includes(p.defaultCategory),
      `Provider "${p.key}" defaultCategory "${p.defaultCategory}" must be a valid slug`,
    );
  }
});

test("every provider's categories[] entries are valid category slugs", () => {
  for (const p of PROVIDERS) {
    assert.ok(Array.isArray(p.categories), `Provider "${p.key}" must declare categories[]`);
    assert.ok(p.categories!.length > 0, `Provider "${p.key}" categories[] must be non-empty`);
    for (const slug of p.categories!) {
      assert.ok(
        CATEGORY_SLUGS.includes(slug),
        `Provider "${p.key}" categories[] entry "${slug}" must be a valid slug`,
      );
    }
  }
});

test("noema defaults to 'ideas' and smithsonian to 'history'", () => {
  assert.equal(getProviderOrFail("noema").defaultCategory, "ideas");
  assert.equal(getProviderOrFail("smithsonian").defaultCategory, "history");
});

test("registry holds exactly the 19 active providers (aeon, voa, bbc news, nbc, publicdomainreview, grist removed)", () => {
  const keys = PROVIDERS.map((p) => p.key).sort();
  assert.deepEqual(keys, [
    "atlasobscura",
    "bbcfeatures",
    "hakaimagazine",
    "huffpost",
    "jstordaily",
    "knowable",
    "natgeo",
    "nautilus",
    "noema",
    "propublica",
    "scientificamerican",
    "smithsonian",
    "technologyreview",
    "theconversation",
    "time",
    "undark",
    "wired",
    "worksinprogress",
    "yalee360",
  ]);
  assert.equal(PROVIDERS.length, 19);
  assert.equal(getProvider("aeon"), null, "aeon must be unregistered");
  assert.equal(getProvider("voa-learning-english"), null, "voa must be unregistered");
  assert.equal(getProvider("publicdomainreview"), null, "publicdomainreview must be unregistered");
  assert.equal(getProvider("grist"), null, "grist must be unregistered");
});

test("getProvider is case-insensitive", () => {
  assert.ok(getProvider("TIME"));
  assert.ok(getProvider("time"));
});

test("source-derived providers are registered", () => {
  for (const key of SOURCE_DERIVED_PROVIDER_KEYS) {
    const provider = getProvider(key);
    assert.ok(provider, `Provider "${key}" must be registered`);
    assert.ok(provider?.seeds.length, `Provider "${key}" must have discovery seeds`);
  }
});

test("source-derived provider cleanup rules cover live newsletter/recirc chrome", () => {
  assert.ok(
    getProviderOrFail("nautilus").cleanup?.dropClassKeywords?.some((kw) =>
      /subscribe|newsletter/i.test(kw),
    ),
    "Nautilus cleanup should drop subscribe/newsletter chrome",
  );
  assert.ok(
    getProviderOrFail("undark").cleanup?.dropTextKeywords?.some((kw) =>
      /newsletter|journeys/i.test(kw),
    ),
    "Undark cleanup should drop newsletter journeys text chrome",
  );
  assert.ok(
    getProviderOrFail("technologyreview").cleanup?.dropClassKeywords?.some((kw) =>
      /deepDive|stayConnected|image-credit/i.test(kw),
    ),
    "Technology Review cleanup should drop deep dive recirc, stayConnected signup, and image credit blocks",
  );
  assert.ok(
    getProviderOrFail("technologyreview").cleanup?.dropTextKeywords?.some((kw) =>
      /the checkup|the algorithm|preferences/i.test(kw),
    ),
    "Technology Review cleanup should drop branded newsletter text chrome",
  );
  assert.notEqual(
    getProviderOrFail("technologyreview").cleanup?.dropFigcaptions,
    true,
    "Technology Review cleanup should keep figcaptions while dropping separate image-credit blocks",
  );
  assert.ok(
    getProviderOrFail("technologyreview").quality?.digestListicleTitlePrefixes?.some((kw) =>
      /the download:/i.test(kw),
    ),
    "Technology Review quality config should own branded digest prefixes",
  );
  assert.ok(
    getProviderOrFail("theconversation").cleanup?.dropTextKeywords?.some((kw) =>
      /republish this article/i.test(kw),
    ),
    "The Conversation cleanup should drop republishing chrome",
  );
  assert.ok(
    getProviderOrFail("propublica").cleanup?.dropTextKeywords?.some((kw) =>
      /propublica is a nonprofit/i.test(kw),
    ),
    "ProPublica cleanup should drop nonprofit/newsletter chrome",
  );
  assert.ok(
    getProviderOrFail("propublica").cleanup?.dropClassKeywords?.some((kw) =>
      /republish/i.test(kw),
    ),
    "ProPublica cleanup should drop republish license modal chrome",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropClassKeywords?.some((kw) =>
      /navigationpanel|bbc-footer/i.test(kw),
    ),
    "BBC Features cleanup should drop navigation drawer and footer chrome",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextKeywords?.some((kw) =>
      /site search/i.test(kw),
    ),
    "BBC Features cleanup should drop standalone hidden site-search labels",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextKeywords?.includes('{"image":{"pid":""}}'),
    "BBC Features cleanup should drop empty image pid placeholder text blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextKeywords?.some((kw) =>
      /weekly bbc\.com features/i.test(kw),
    ),
    "BBC Features cleanup should drop trailing newsletter CTA blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextKeywords?.some((kw) =>
      /is a bbc travel series/i.test(kw),
    ),
    "BBC Features cleanup should drop Travel series promo blocks by text",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropLinkHrefBlockKeywords?.some((kw) =>
      /\/travel\/columns\//i.test(kw),
    ),
    "BBC Features cleanup should drop short Travel columns promo link blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropLinkHrefBlockKeywords?.some((kw) =>
      /\/travel\/worlds-table/i.test(kw),
    ),
    "BBC Features cleanup should drop World's Table promo link blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextKeywords?.some((kw) =>
      /previous version of this article/i.test(kw),
    ),
    "BBC Features cleanup should drop correction-note footer blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextKeywords?.some((kw) =>
      /bear country/i.test(kw),
    ),
    "BBC Features cleanup should drop standardized safety note blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropLinkHrefBlockKeywords?.some((kw) =>
      /pages\.emails\.bbc\.com\/subscribe/i.test(kw),
    ),
    "BBC Features cleanup should drop short email-subscription link blocks",
  );
  assert.ok(
    getProviderOrFail("bbcfeatures").cleanup?.dropTextExactKeywords?.includes("--") &&
      getProviderOrFail("bbcfeatures").cleanup?.dropTextExactKeywords?.includes("---"),
    "BBC Features cleanup should drop standalone trailing dash separators",
  );
});

test("source-derived provider URL patterns match article URLs", () => {
  assertProviderUrlPatterns([
    ["bbcfeatures", "https://www.bbc.com/future/article/20260630-how-america-reinvented-english"],
    ["bbcfeatures", "https://www.bbc.com/travel/article/20260701-the-view-that-inspired-america-the-beautiful"],
    ["bbcfeatures", "https://www.bbc.com/culture/article/20260702-the-back-to-the-future-parody-thats-a-global-hit"],
    ["bbcfeatures", "https://www.bbc.com/worklife/article/20260520-how-social-media-ceased-to-be-social"],
    ["smithsonian", "https://www.smithsonianmag.com/science-nature/example-story-180987800/"],
    ["knowable", "https://knowablemagazine.org/content/article/technology/2026/example-story"],
    ["nautilus", "https://nautil.us/example-story-123456/"],
    ["nautilus", "https://nautil.us/legacy-feature/"],
    ["nautilus", "https://nautil.us/legacy_feature/"],
    ["nautilus", "https://nautil.us/encoded-%e2%80%99/"],
    ["technologyreview", "https://www.technologyreview.com/2026/06/23/123456/example-story/"],
    [
      "theconversation",
      "https://theconversation.com/why-rural-healthcare-funds-50b-focus-on-tech-upgrades-may-not-help-vulnerable-hospitals-and-providers-279931",
    ],
    ["propublica", "https://www.propublica.org/article/florida-death-penalty-executions-ron-desantis"],
    ["atlasobscura", "https://www.atlasobscura.com/articles/mummy-madness-10-of-the-most-amazing-mummies-in-the-world"],
    ["atlasobscura", "https://www.atlasobscura.com/foods/poutine"],
    ["jstordaily", "https://daily.jstor.org/internet-things-totally-new-hundred-years-old/"],
    ["hakaimagazine", "https://hakaimagazine.com/features/the-canoe-in-the-forest/"],
    ["hakaimagazine", "https://hakaimagazine.com/news/how-exactly-could-deep-sea-mining-benefit-all-of-humanity/"],
    ["hakaimagazine", "https://hakaimagazine.com/videos-visuals/one-great-shot-let-us-admire-the-lettuce-slug/"],
    ["hakaimagazine", "https://hakaimagazine.com/article-short/so-long-and-thanks-for-all-the-fish/"],
    ["yalee360", "https://e360.yale.edu/features/home-battery-vpps"],
    ["worksinprogress", "https://worksinprogress.co/issue/how-to-build-a-state"],
    ["noema", "https://www.noemamag.com/example-story/"],
    ["natgeo", "https://www.nationalgeographic.com/travel/national-parks/article/acadia-national-park"],
    ["natgeo", "https://www.nationalgeographic.com/premium/article/benefits-pet-dog-ownership-mental-health"],
    ["undark", "https://undark.org/2026/06/23/example-story/"],
    ["undark", "https://undark.org/shreds-of-evidence-edna/"],
    ["undark", "https://race.undark.org/articles/good-blood-bad-policy-the-red-cross-and-jim-crow"],
    ["wired", "https://www.wired.com/story/prediction-markets-let-you-bet-wildfire/"],
  ]);
});

test("source-derived URL filters reject non-article pages", () => {
  const bbcFeatures = getProviderOrFail("bbcfeatures");
  assert.equal(bbcFeatures.articleUrlFilter?.("https://www.bbc.com/news/articles/c1234567890"), false);
  assert.equal(bbcFeatures.articleUrlFilter?.("https://www.bbc.com/future"), false);
  assert.equal(
    bbcFeatures.articleUrlFilter?.("https://www.bbc.com/future/article/20260630-how-america-reinvented-english"),
    true,
  );

  const smithsonian = getProviderOrFail("smithsonian");
  assert.equal(smithsonian.articleUrlFilter?.("https://www.smithsonianmag.com/category/science-nature/"), false);

  const nautilus = getProviderOrFail("nautilus");
  assert.equal(nautilus.articleUrlFilter?.("https://nautil.us/newsletter/example/"), false);
  assert.equal(nautilus.articleUrlFilter?.("https://nautil.us/category/cosmos/"), false);

  const technologyReview = getProviderOrFail("technologyreview");
  assert.equal(technologyReview.articleUrlFilter?.("https://www.technologyreview.com/topic/artificial-intelligence/"), false);
  assert.equal(
    technologyReview.articleUrlFilter?.(
      "https://www.technologyreview.com/2026/06/29/1139834/the-download-metric-weaknesses-ai-elephant-warnings/",
    ),
    false,
  );

  const conversation = getProviderOrFail("theconversation");
  assert.equal(conversation.articleUrlFilter?.("https://theconversation.com/us/topics/politics-34"), false);
  assert.equal(
    conversation.articleUrlFilter?.(
      "https://theconversation.com/why-rural-healthcare-funds-50b-focus-on-tech-upgrades-may-not-help-vulnerable-hospitals-and-providers-279931",
    ),
    true,
  );

  const propublica = getProviderOrFail("propublica");
  assert.equal(propublica.articleUrlFilter?.("https://www.propublica.org/topics/politics"), false);
  assert.equal(
    propublica.articleUrlFilter?.("https://www.propublica.org/article/florida-death-penalty-executions-ron-desantis"),
    true,
  );

  const atlas = getProviderOrFail("atlasobscura");
  assert.equal(atlas.articleUrlFilter?.("https://www.atlasobscura.com/places/obscure-place"), false);
  assert.equal(atlas.articleUrlFilter?.("https://www.atlasobscura.com/articles/podcast-hidden-place"), false);
  assert.equal(atlas.articleUrlFilter?.("https://www.atlasobscura.com/articles/hidden-history"), true);

  const jstor = getProviderOrFail("jstordaily");
  assert.equal(jstor.articleUrlFilter?.("https://daily.jstor.org/archives/"), false);
  assert.equal(jstor.articleUrlFilter?.("https://daily.jstor.org/hidden-history/"), true);

  const hakai = getProviderOrFail("hakaimagazine");
  assert.equal(hakai.articleUrlFilter?.("https://hakaimagazine.com/wp-content/uploads/image.jpg"), false);
  assert.equal(hakai.articleUrlFilter?.("https://hakaimagazine.com/profiles/the-fleet-winged-ghosts-of-greenland/"), false);
  assert.equal(hakai.articleUrlFilter?.("https://hakaimagazine.com/about-us/"), false);
  assert.equal(hakai.articleUrlFilter?.("https://hakaimagazine.com/features/the-canoe-in-the-forest/"), true);
  assert.equal(
    hakai.articleUrlFilter?.("https://hakaimagazine.com/news/how-exactly-could-deep-sea-mining-benefit-all-of-humanity/"),
    true,
  );
  assert.equal(
    hakai.articleUrlFilter?.("https://hakaimagazine.com/videos-visuals/one-great-shot-let-us-admire-the-lettuce-slug/"),
    true,
  );
  assert.equal(
    hakai.articleUrlFilter?.("https://hakaimagazine.com/article-short/so-long-and-thanks-for-all-the-fish/"),
    true,
  );

  const yale = getProviderOrFail("yalee360");
  assert.equal(yale.articleUrlFilter?.("https://e360.yale.edu/digest/sperm-whale-dialects"), false);
  assert.equal(yale.articleUrlFilter?.("https://e360.yale.edu/features/home-battery-vpps"), true);
  assert.equal(yale.articleUrlFilter?.("https://e360.yale.edu/features/p2"), false);
  assert.equal(
    yale.articleUrlFilter?.("https://e360.yale.edu/features/p87?lt%3Bmy_tag_0e553ec3a07a6cfbbc95d7411dcd694c"),
    false,
  );

  const wip = getProviderOrFail("worksinprogress");
  assert.equal(wip.articleUrlFilter?.("https://worksinprogress.co/wp-content/uploads/hero.jpg"), false);
  assert.equal(wip.articleUrlFilter?.("https://worksinprogress.co/issue/how-to-build-a-state"), true);

  const natgeo = getProviderOrFail("natgeo");
  assert.equal(
    natgeo.articleUrlFilter?.(
      "https://www.nationalgeographic.com/travel/article/paid-content-escape-to-the-country",
    ),
    false,
  );
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/newsletters/article/stones-bones-dino-monsters"),
    false,
  );
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/travel/article/hong_kong_food_and_wine"),
    false,
  );
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/contests/article/travel-photo-contest-2016-winners"),
    false,
  );
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/maps/article/yellowstone-map-embed-full"),
    false,
  );
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/books/article/8-photos-women-Nat-Geo-archive"),
    false,
  );
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/pages/article/afghan-girl-home-afghanistan"),
    true,
  );
  assert.equal(
    natgeo.articleUrlFilter?.(
      "https://www.nationalgeographic.com/travel/national-parks/article/acadia-national-park",
    ),
    true,
  );

  const undark = getProviderOrFail("undark");
  assert.equal(undark.articleUrlFilter?.("https://undark.org/tag/climate-change/"), false);
  assert.equal(undark.articleUrlFilter?.("https://undark.org/funding/"), false);
  assert.equal(undark.articleUrlFilter?.("https://undark.org/2023/10/12/funding-innovation-younger/"), true);

  const wired = getProviderOrFail("wired");
  assert.equal(wired.articleUrlFilter?.("https://www.wired.com/gallery/best-wifi-routers/"), false);
  assert.equal(wired.articleUrlFilter?.("https://www.wired.com/review/tcl-rm9l/"), false);
  assert.equal(wired.articleUrlFilter?.("https://www.wired.com/story/dell-coupon-code/"), false);
  assert.equal(wired.articleUrlFilter?.("https://www.wired.com/story/best-july-fourth-mattress-deals-2026/"), false);
  assert.equal(wired.articleUrlFilter?.("https://www.wired.com/story/security-roundup-apples-hide-my-email-service-fails-to-hide-your-email/"), true);
});

test("smithsonian paginates category seeds with page query", () => {
  const smithsonian = getProviderOrFail("smithsonian");
  assert.ok((smithsonian.maxSeedPages ?? 1) > 1);
  assert.equal(
    smithsonian.paginateSeed?.("https://www.smithsonianmag.com/category/science-nature/", 2),
    "https://www.smithsonianmag.com/category/science-nature/?page=2",
  );
});

// ---------------------------------------------------------------------------
// mapSectionToCategory
// ---------------------------------------------------------------------------

test("mapSectionToCategory handles learner-English topic strings", () => {
  assertSectionCategories([
    ["science", "science"],
    ["sports", "sports"],
    ["health", "health"],
    ["technology", "tech"],
    ["entertainment", "entertainment"],
    ["unknown-topic", null],
  ]);
});

test("mapSectionToCategory routes granular sections to new categories", () => {
  assertSectionCategories([
    ["environment", "environment"],
    ["climate", "environment"],
    ["wildlife", "animals"],
    ["history", "history"],
    ["ancient", "history"],
    ["travel", "travel"],
    ["philosophy", "ideas"],
    ["essay", "ideas"],
  ]);
});

test("mapSectionToCategory routes animal/wildlife sections to animals", () => {
  assertSectionCategories([
    ["animal", "animals"],
    ["animals", "animals"],
    ["wildlife", "animals"],
    ["species", "animals"],
    ["endangered species", "animals"],
    ["extinction", "animals"],
    ["marine life", "animals"],
    ["pets", "animals"],
    ["fauna", "animals"],
    ["creature", "animals"],
  ]);
});

test("mapSectionToCategory: science discipline framing beats animals", () => {
  // zoology/biology/evolution are science-first even though they concern animals
  assertSectionCategories([
    ["zoology", "science"],
    ["biology", "science"],
    ["evolution", "science"],
    ["science-nature", "science"],
    ["living world", "science"],
  ]);
});

test("mapSectionToCategory: environment keeps non-animal nature/conservation terms", () => {
  assertSectionCategories([
    ["climate", "environment"],
    ["conservation", "environment"],
    ["ecosystem", "environment"],
    ["nature", "environment"],
    ["ocean", "environment"],
  ]);
});

test("mapSectionToCategory: animals border does NOT catch wildfire/wilderness/marine corps", () => {
  assert.notEqual(mapSectionToCategory("wildfire"), "animals");
  assert.notEqual(mapSectionToCategory("wilderness"), "animals");
  assert.notEqual(mapSectionToCategory("marine corps"), "animals");
});

test("mapSectionToCategory regression: science/culture/entertainment buckets unchanged", () => {
  assertSectionCategories([
    ["space", "science"],
    ["astronomy", "science"],
    ["physics", "science"],
    ["art", "culture"],
    ["book", "culture"],
    ["movie", "entertainment"],
  ]);
});

test("mapSectionToCategory FIX: 'living world' and 'science-nature' resolve to science", () => {
  // BUG 1: "living world" used to leak into `world` via the \bworld rule.
  // BUG 2: "science-nature" used to leak into `environment` via the `nature` rule.
  assertSectionCategories([
    ["living world", "science"],
    ["living-world", "science"],
    ["science-nature", "science"],
    ["science & nature", "science"],
    ["science nature", "science"],
    ["the mind", "science"],
    ["mind", "science"],
  ]);
});

test("mapSectionToCategory: new science keywords route to science", () => {
  assertSectionCategories([
    ["biology", "science"],
    ["zoology", "science"],
    ["paleontology", "science"],
    ["psychology", "science"],
    ["neuroscience", "science"],
    ["astronomy", "science"],
    ["astrophysics", "science"],
    ["physics", "science"],
    ["chemistry", "science"],
    ["math", "science"],
    ["mathematics", "science"],
    ["genetics", "science"],
    ["cosmos", "science"],
  ]);
});

test("mapSectionToCategory: new tech keywords route to tech (AI → tech)", () => {
  assertSectionCategories([
    ["innovation", "tech"],
    ["computing", "tech"],
    ["artificial intelligence", "tech"],
    ["ai", "tech"],
    ["robotics", "tech"],
    ["software", "tech"],
    ["gadget", "tech"],
  ]);
});

test("mapSectionToCategory: society routes to culture", () => {
  assert.equal(mapSectionToCategory("society"), "culture");
  assert.equal(mapSectionToCategory("social science"), "culture");
});

test("mapSectionToCategory regression: climate→environment, music→entertainment hold", () => {
  assert.equal(mapSectionToCategory("climate"), "environment");
  assert.equal(mapSectionToCategory("wildlife"), "animals");
  assert.equal(mapSectionToCategory("music"), "entertainment");
  assert.equal(mapSectionToCategory("art"), "culture");
  assert.equal(mapSectionToCategory("space"), "science");
});

// ---------------------------------------------------------------------------
// Per-provider categoryFor (idiosyncratic section labels from live discovery)
// ---------------------------------------------------------------------------

test("knowable categoryFor: 'living world' → science, 'society' → culture", () => {
  const p = getProviderOrFail("knowable");
  const u = new URL("https://knowablemagazine.org/content/article/society/2026/example-story");
  assert.equal(p.categoryFor!(u, "Living World"), "science");
  assert.equal(p.categoryFor!(u, "The Mind"), "science");
  assert.equal(p.categoryFor!(u, "Society"), "culture");
  assert.equal(p.categoryFor!(u, "Health & Disease"), "health");
  assert.equal(p.categoryFor!(u, "Food & Environment"), "environment");
  assert.equal(p.categoryFor!(u, "Technology"), "tech");
});

test("undark categoryFor: 'fish & wildlife' → animals, 'science policy' → politics", () => {
  const p = getProviderOrFail("undark");
  const u = new URL("https://undark.org/2026/06/23/example-story/");
  assert.equal(p.categoryFor!(u, "Fish & Wildlife"), "animals");
  assert.equal(p.categoryFor!(u, "Environment & Conservation"), "environment");
  assert.equal(p.categoryFor!(u, "Health & Medicine"), "health");
  assert.equal(p.categoryFor!(u, "Technology & Innovation"), "tech");
  assert.equal(p.categoryFor!(u, "Science Policy"), "politics");
  assert.equal(p.categoryFor!(u, "Space & Astronomy"), "science");
  assert.equal(p.categoryFor!(u, "Math & Physics"), "science");
  assert.equal(p.categoryFor!(u, "Social Sciences"), "culture");
  assert.equal(p.categoryFor!(u, "Books"), "culture");
  // newsletter/format labels fall through to null
  assert.equal(p.categoryFor!(u, "Viewpoints"), null);
  assert.equal(p.categoryFor!(u, "Interviews"), null);
});

test("technologyreview categoryFor: biotech→health, climate change & energy→environment", () => {
  const p = getProviderOrFail("technologyreview");
  const u = new URL("https://www.technologyreview.com/2026/06/23/123456/example-story/");
  assert.equal(p.categoryFor!(u, "Artificial intelligence"), "tech");
  assert.equal(p.categoryFor!(u, "Computing"), "tech");
  assert.equal(p.categoryFor!(u, "Biotechnology and health"), "health");
  assert.equal(p.categoryFor!(u, "Climate change and energy"), "environment");
  assert.equal(p.categoryFor!(u, "The Download"), null);
  assert.equal(p.categoryFor!(u, "Sponsored"), null);
});

test("wired categoryFor maps sections and story slugs across major verticals", () => {
  const p = getProviderOrFail("wired");
  assert.equal(
    p.categoryFor!(new URL("https://www.wired.com/story/prediction-markets-let-you-bet-wildfire/"), "Science / Environment"),
    "environment",
  );
  assert.equal(
    p.categoryFor!(
      new URL("https://www.wired.com/story/security-roundup-apples-hide-my-email-service-fails-to-hide-your-email/"),
      "Security / Privacy",
    ),
    "tech",
  );
  assert.equal(
    p.categoryFor!(new URL("https://www.wired.com/story/book-club-the-yahoo-boys-chapter-7-9/"), "Culture / Books"),
    "culture",
  );
  assert.equal(
    p.categoryFor!(new URL("https://www.wired.com/story/love-island-usa-app/"), "Culture"),
    "entertainment",
  );
  assert.equal(
    p.categoryFor!(new URL("https://www.wired.com/story/google-deepmind-unionization-talks-are-off-to-a-rocky-start/"), "Business"),
    "business",
  );
});

test("theconversation categoryFor: slug/keyword rules fill gap categories", () => {
  const p = getProviderOrFail("theconversation");
  assert.equal(
    p.categoryFor!(
      new URL("https://theconversation.com/why-rural-healthcare-funds-50b-focus-on-tech-upgrades-may-not-help-vulnerable-hospitals-and-providers-279931"),
      "Rural healthcare, Hospitals",
    ),
    "health",
  );
  assert.equal(
    p.categoryFor!(
      new URL("https://theconversation.com/in-2-landmark-decisions-the-supreme-court-expands-gun-rights-286230"),
      "Supreme Court, Gun rights",
    ),
    "politics",
  );
  assert.equal(
    p.categoryFor!(
      new URL("https://theconversation.com/college-is-unaffordable-for-many-americans-but-dont-just-blame-rising-tuition-285095"),
      "Tuition, Debt",
    ),
    "business",
  );
});

test("propublica categoryFor: national/criminal justice maps to politics", () => {
  const p = getProviderOrFail("propublica");
  const u = new URL("https://www.propublica.org/article/florida-death-penalty-executions-ron-desantis");
  assert.equal(p.categoryFor!(u, null), "politics");
  assert.equal(p.categoryFor!(u, "National"), "politics");
  assert.equal(p.categoryFor!(u, "Health Care"), "health");
  assert.equal(p.categoryFor!(u, "Business"), "business");
});

test("smithsonian categoryFor: science-nature→science, innovation→tech", () => {
  const p = getProviderOrFail("smithsonian");
  assert.equal(
    p.categoryFor!(new URL("https://www.smithsonianmag.com/science-nature/example-180987800/"), "Science & Nature"),
    "science",
  );
  assert.equal(
    p.categoryFor!(new URL("https://www.smithsonianmag.com/innovation/example-180987800/"), "Innovation"),
    "tech",
  );
  assert.equal(
    p.categoryFor!(new URL("https://www.smithsonianmag.com/history/example-180987800/"), "History"),
    "history",
  );
  assert.equal(
    p.categoryFor!(new URL("https://www.smithsonianmag.com/arts-culture/example-180987800/"), "Arts & Culture"),
    "culture",
  );
});

// ---------------------------------------------------------------------------
// Per-provider readingCategories overrides (#provider-reading-cats)
// ---------------------------------------------------------------------------

test("every provider's readingCategories (when set) are valid slugs ⊆ its categories[]", () => {
  for (const p of PROVIDERS) {
    if (p.readingCategories == null) continue;
    assert.ok(
      Array.isArray(p.categories) && p.categories.length > 0,
      `${p.key}: readingCategories requires a non-empty categories[]`,
    );
    for (const slug of p.readingCategories) {
      assert.ok(CATEGORY_SLUGS.includes(slug), `${p.key}: "${slug}" is not a valid category slug`);
      assert.ok(
        p.categories!.includes(slug),
        `${p.key}: readingCategories "${slug}" must be a subset of categories[]`,
      );
    }
    // No duplicates.
    assert.equal(
      new Set(p.readingCategories).size,
      p.readingCategories.length,
      `${p.key}: readingCategories must not contain duplicates`,
    );
  }
});

test("long-form publishers override readingCategories to their FULL categories[]", () => {
  for (const key of LONG_FORM_PROVIDER_KEYS) {
    const provider = getProviderOrFail(key);
    assert.deepEqual(
      provider.readingCategories,
      provider.categories,
      `${key}: long-form provider should treat every category as reading-suitable`,
    );
  }
});

test("news/learning providers OMIT readingCategories (fall back to the global tier)", () => {
  for (const key of NEWS_LEARNING_PROVIDER_KEYS) {
    const provider = getProviderOrFail(key);
    assert.equal(provider.readingCategories, undefined, `${key}: should omit readingCategories`);
  }
});

test("providerReadingCategories returns the override when set, else categories[] ∩ recommended", () => {
  const noema = getProviderOrFail("noema");
  // Override present → returned verbatim (includes globally-"low" politics).
  assert.deepEqual(providerReadingCategories(noema), noema.categories);
  assert.ok(providerReadingCategories(noema).includes("politics"));

  // No override → categories[] intersected with the global recommended tier
  // (drops globally-"low" politics).
  const huffpost = getProviderOrFail("huffpost");
  const expected = huffpost.categories!.filter(isReadingRecommended);
  assert.deepEqual(providerReadingCategories(huffpost), expected);
  assert.ok(!providerReadingCategories(huffpost).includes("politics"));
});

test("isProviderCategoryReadingSuitable honours overrides and rejects null", () => {
  const noema = getProviderOrFail("noema");
  assert.equal(isProviderCategoryReadingSuitable(noema, "politics"), true); // override
  assert.equal(isProviderCategoryReadingSuitable(noema, "sports"), false); // not in categories
  assert.equal(isProviderCategoryReadingSuitable(noema, null), false);

  const huffpost = getProviderOrFail("huffpost");
  assert.equal(isProviderCategoryReadingSuitable(huffpost, "politics"), false); // default drops low
  assert.equal(isProviderCategoryReadingSuitable(huffpost, "health"), true);
});

test("getProviderByName resolves by Article.source name, case-insensitively", () => {
  assert.equal(getProviderByName("Noema Magazine")?.key, "noema");
  assert.equal(getProviderByName("  noema magazine  ")?.key, "noema");
  assert.equal(getProviderByName("Time")?.key, "time");
  assert.equal(getProviderByName("BBC Features")?.key, "bbcfeatures");
  assert.equal(getProviderByName("The Conversation")?.key, "theconversation");
  assert.equal(getProviderByName("ProPublica")?.key, "propublica");
  assert.equal(getProviderByName("Unknown Source"), null);
  assert.equal(getProviderByName(""), null);
});
