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

function getProviderOrFail(key: string) {
  const p = getProvider(key);
  assert.ok(p, `Provider "${key}" must be registered`);
  return p!;
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

test("registry holds exactly the 11 active providers (aeon + voa removed)", () => {
  const keys = PROVIDERS.map((p) => p.key).sort();
  assert.deepEqual(keys, [
    "bbc",
    "huffpost",
    "knowable",
    "natgeo",
    "nautilus",
    "nbc",
    "noema",
    "smithsonian",
    "technologyreview",
    "time",
    "undark",
  ]);
  assert.equal(PROVIDERS.length, 11);
  assert.equal(getProvider("aeon"), null, "aeon must be unregistered");
  assert.equal(getProvider("voa-learning-english"), null, "voa must be unregistered");
});

test("getProvider is case-insensitive", () => {
  assert.ok(getProvider("NBC"));
  assert.ok(getProvider("nbc"));
});

test("source-derived providers are registered", () => {
  for (const key of [
    "bbc",
    "smithsonian",
    "knowable",
    "nautilus",
    "technologyreview",
    "noema",
    "undark",
  ]) {
    const p = getProvider(key);
    assert.ok(p, `Provider "${key}" must be registered`);
    assert.ok(p?.seeds.length, `Provider "${key}" must have discovery seeds`);
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
      /deepDive|stayConnected/i.test(kw),
    ),
    "Technology Review cleanup should drop deep dive recirc and stayConnected signup blocks",
  );
  assert.ok(
    getProviderOrFail("technologyreview").cleanup?.dropTextKeywords?.some((kw) =>
      /the checkup|preferences/i.test(kw),
    ),
    "Technology Review cleanup should drop branded newsletter text chrome",
  );
  assert.ok(
    getProviderOrFail("technologyreview").quality?.digestListicleTitlePrefixes?.some((kw) =>
      /the download:/i.test(kw),
    ),
    "Technology Review quality config should own branded digest prefixes",
  );
});

test("source-derived provider URL patterns match article URLs", () => {
  assert.ok(getProviderOrFail("bbc").articleUrlPattern.test("https://www.bbc.com/news/articles/c1234567890"));
  assert.ok(
    getProviderOrFail("smithsonian").articleUrlPattern.test(
      "https://www.smithsonianmag.com/science-nature/example-story-180987800/",
    ),
  );
  assert.ok(
    getProviderOrFail("knowable").articleUrlPattern.test(
      "https://knowablemagazine.org/content/article/technology/2026/example-story",
    ),
  );
  assert.ok(getProviderOrFail("nautilus").articleUrlPattern.test("https://nautil.us/example-story-123456/"));
  assert.ok(
    getProviderOrFail("technologyreview").articleUrlPattern.test(
      "https://www.technologyreview.com/2026/06/23/123456/example-story/",
    ),
  );
  assert.ok(getProviderOrFail("noema").articleUrlPattern.test("https://www.noemamag.com/example-story/"));
  assert.ok(getProviderOrFail("undark").articleUrlPattern.test("https://undark.org/2026/06/23/example-story/"));
});

test("source-derived URL filters reject non-article pages", () => {
  const bbc = getProviderOrFail("bbc");
  assert.equal(bbc.articleUrlFilter?.("https://www.bbc.com/news/live/c1234567890"), false);

  const smithsonian = getProviderOrFail("smithsonian");
  assert.equal(smithsonian.articleUrlFilter?.("https://www.smithsonianmag.com/category/science-nature/"), false);

  const technologyReview = getProviderOrFail("technologyreview");
  assert.equal(technologyReview.articleUrlFilter?.("https://www.technologyreview.com/topic/artificial-intelligence/"), false);

  const undark = getProviderOrFail("undark");
  assert.equal(undark.articleUrlFilter?.("https://undark.org/tag/climate-change/"), false);
});

// ---------------------------------------------------------------------------
// mapSectionToCategory
// ---------------------------------------------------------------------------

test("mapSectionToCategory handles learner-English topic strings", () => {
  assert.equal(mapSectionToCategory("science"), "science");
  assert.equal(mapSectionToCategory("sports"), "sports");
  assert.equal(mapSectionToCategory("health"), "health");
  assert.equal(mapSectionToCategory("technology"), "tech");
  assert.equal(mapSectionToCategory("entertainment"), "entertainment");
  assert.equal(mapSectionToCategory("unknown-topic"), null);
});

test("mapSectionToCategory routes granular sections to new categories", () => {
  assert.equal(mapSectionToCategory("environment"), "environment");
  assert.equal(mapSectionToCategory("climate"), "environment");
  assert.equal(mapSectionToCategory("wildlife"), "animals");
  assert.equal(mapSectionToCategory("history"), "history");
  assert.equal(mapSectionToCategory("ancient"), "history");
  assert.equal(mapSectionToCategory("travel"), "travel");
  assert.equal(mapSectionToCategory("philosophy"), "ideas");
  assert.equal(mapSectionToCategory("essay"), "ideas");
});

test("mapSectionToCategory routes animal/wildlife sections to animals", () => {
  assert.equal(mapSectionToCategory("animal"), "animals");
  assert.equal(mapSectionToCategory("animals"), "animals");
  assert.equal(mapSectionToCategory("wildlife"), "animals");
  assert.equal(mapSectionToCategory("species"), "animals");
  assert.equal(mapSectionToCategory("endangered species"), "animals");
  assert.equal(mapSectionToCategory("extinction"), "animals");
  assert.equal(mapSectionToCategory("marine life"), "animals");
  assert.equal(mapSectionToCategory("pets"), "animals");
  assert.equal(mapSectionToCategory("fauna"), "animals");
  assert.equal(mapSectionToCategory("creature"), "animals");
});

test("mapSectionToCategory: science discipline framing beats animals", () => {
  // zoology/biology/evolution are science-first even though they concern animals
  assert.equal(mapSectionToCategory("zoology"), "science");
  assert.equal(mapSectionToCategory("biology"), "science");
  assert.equal(mapSectionToCategory("evolution"), "science");
  assert.equal(mapSectionToCategory("science-nature"), "science");
  assert.equal(mapSectionToCategory("living world"), "science");
});

test("mapSectionToCategory: environment keeps non-animal nature/conservation terms", () => {
  assert.equal(mapSectionToCategory("climate"), "environment");
  assert.equal(mapSectionToCategory("conservation"), "environment");
  assert.equal(mapSectionToCategory("ecosystem"), "environment");
  assert.equal(mapSectionToCategory("nature"), "environment");
  assert.equal(mapSectionToCategory("ocean"), "environment");
});

test("mapSectionToCategory: animals border does NOT catch wildfire/wilderness/marine corps", () => {
  assert.notEqual(mapSectionToCategory("wildfire"), "animals");
  assert.notEqual(mapSectionToCategory("wilderness"), "animals");
  assert.notEqual(mapSectionToCategory("marine corps"), "animals");
});

test("mapSectionToCategory regression: science/culture/entertainment buckets unchanged", () => {
  assert.equal(mapSectionToCategory("space"), "science");
  assert.equal(mapSectionToCategory("astronomy"), "science");
  assert.equal(mapSectionToCategory("physics"), "science");
  assert.equal(mapSectionToCategory("art"), "culture");
  assert.equal(mapSectionToCategory("book"), "culture");
  assert.equal(mapSectionToCategory("movie"), "entertainment");
});

test("mapSectionToCategory FIX: 'living world' and 'science-nature' resolve to science", () => {
  // BUG 1: "living world" used to leak into `world` via the \bworld rule.
  assert.equal(mapSectionToCategory("living world"), "science");
  assert.equal(mapSectionToCategory("living-world"), "science");
  // BUG 2: "science-nature" used to leak into `environment` via the `nature` rule.
  assert.equal(mapSectionToCategory("science-nature"), "science");
  assert.equal(mapSectionToCategory("science & nature"), "science");
  assert.equal(mapSectionToCategory("science nature"), "science");
  assert.equal(mapSectionToCategory("the mind"), "science");
  assert.equal(mapSectionToCategory("mind"), "science");
});

test("mapSectionToCategory: new science keywords route to science", () => {
  for (const s of ["biology", "zoology", "paleontology", "psychology", "neuroscience", "astronomy", "astrophysics", "physics", "chemistry", "math", "mathematics", "genetics", "cosmos"]) {
    assert.equal(mapSectionToCategory(s), "science", `"${s}" should map to science`);
  }
});

test("mapSectionToCategory: new tech keywords route to tech (AI → tech)", () => {
  for (const s of ["innovation", "computing", "artificial intelligence", "ai", "robotics", "software", "gadget"]) {
    assert.equal(mapSectionToCategory(s), "tech", `"${s}" should map to tech`);
  }
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

test("long-form magazines override readingCategories to their FULL categories[]", () => {
  for (const key of ["natgeo", "smithsonian", "knowable", "nautilus", "technologyreview", "noema", "undark"]) {
    const p = getProviderOrFail(key);
    assert.deepEqual(
      p.readingCategories,
      p.categories,
      `${key}: magazine should treat every category as reading-suitable`,
    );
  }
});

test("news/learning providers OMIT readingCategories (fall back to the global tier)", () => {
  for (const key of ["nbc", "time", "huffpost", "bbc"]) {
    const p = getProviderOrFail(key);
    assert.equal(p.readingCategories, undefined, `${key}: should omit readingCategories`);
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
  assert.equal(getProviderByName("NBC News")?.key, "nbc");
  assert.equal(getProviderByName("Unknown Source"), null);
  assert.equal(getProviderByName(""), null);
});
