/**
 * Tests for the canonical category taxonomy in src/lib/categories.ts.
 * Verifies the 14 slugs/labels, gradient coverage, and validity helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  CATEGORY_SLUGS,
  CATEGORY_COLORS,
  categoryGradient,
  isValidCategorySlug,
  humanizeCategorySlug,
  readingSuitabilityOf,
  readingSuitabilityRank,
  isReadingRecommended,
  READING_RECOMMENDED_CATEGORIES,
} from "@/lib/categories";

const EXPECTED: ReadonlyArray<[string, string]> = [
  ["world", "World"],
  ["politics", "Politics"],
  ["business", "Business"],
  ["health", "Health"],
  ["science", "Science"],
  ["environment", "Environment"],
  ["animals", "Animals"],
  ["tech", "Tech"],
  ["sports", "Sports"],
  ["culture", "Culture"],
  ["history", "History"],
  ["travel", "Travel"],
  ["ideas", "Ideas"],
  ["entertainment", "Entertainment"],
];

test("CATEGORIES contains exactly the 14 expected slug/label pairs", () => {
  assert.equal(CATEGORIES.length, 14);
  for (const [slug, label] of EXPECTED) {
    const found = CATEGORIES.find((c) => c.slug === slug);
    assert.ok(found, `category "${slug}" must be present`);
    assert.equal(found!.label, label);
  }
});

test("CATEGORY_SLUGS mirrors CATEGORIES order", () => {
  assert.deepEqual([...CATEGORY_SLUGS], EXPECTED.map(([slug]) => slug));
});

test("the animals category is present with its label and gradient", () => {
  assert.ok(CATEGORY_SLUGS.includes("animals"), `"animals" must be a valid slug`);
  assert.ok(isValidCategorySlug("animals"), `isValidCategorySlug("animals") must be true`);
  assert.equal(humanizeCategorySlug("animals"), "Animals");
  const g = CATEGORY_COLORS.animals;
  assert.ok(g, "animals must have a gradient");
  assert.match(g.from, /^#[0-9a-fA-F]{6}$/);
  assert.match(g.to, /^#[0-9a-fA-F]{6}$/);
  // animals must be visually distinct from environment (green) and history (amber-brown)
  assert.notDeepEqual(g, CATEGORY_COLORS.environment);
  assert.notDeepEqual(g, CATEGORY_COLORS.history);
});

test("the four new categories are present", () => {
  for (const slug of ["environment", "history", "travel", "ideas"]) {
    assert.ok(CATEGORY_SLUGS.includes(slug), `"${slug}" must be a valid slug`);
    assert.ok(isValidCategorySlug(slug), `isValidCategorySlug("${slug}") must be true`);
  }
});

test("every category has a non-empty hex gradient pair", () => {
  for (const { slug } of CATEGORIES) {
    const g = CATEGORY_COLORS[slug];
    assert.ok(g, `category "${slug}" must have a gradient`);
    assert.match(g.from, /^#[0-9a-fA-F]{6}$/, `"${slug}" from must be a hex color`);
    assert.match(g.to, /^#[0-9a-fA-F]{6}$/, `"${slug}" to must be a hex color`);
  }
});

test("categoryGradient returns registered pairs and a neutral fallback", () => {
  assert.deepEqual(categoryGradient("environment"), CATEGORY_COLORS.environment);
  assert.deepEqual(categoryGradient("ideas"), CATEGORY_COLORS.ideas);
  assert.deepEqual(categoryGradient(null), { from: "#64748b", to: "#475569" });
  assert.deepEqual(categoryGradient("nonexistent"), { from: "#64748b", to: "#475569" });
});

test("isValidCategorySlug distinguishes known from unknown slugs", () => {
  assert.equal(isValidCategorySlug("history"), true);
  assert.equal(isValidCategorySlug("not-a-category"), false);
});

test("humanizeCategorySlug uses registered labels and humanizes unknown slugs", () => {
  assert.equal(humanizeCategorySlug("ideas"), "Ideas");
  assert.equal(humanizeCategorySlug("travel"), "Travel");
  assert.equal(humanizeCategorySlug("some-unknown_slug"), "Some Unknown Slug");
});

// ---------------------------------------------------------------------------
// Reading-suitability tiers
// ---------------------------------------------------------------------------

const EXPECTED_SUITABILITY: Record<string, "high" | "medium" | "low"> = {
  science: "high",
  ideas: "high",
  culture: "high",
  history: "high",
  environment: "high",
  animals: "high",
  travel: "high",
  health: "high",
  world: "medium",
  tech: "medium",
  business: "medium",
  entertainment: "medium",
  politics: "low",
  sports: "low",
};

test("every category has a valid readingSuitability tier", () => {
  for (const c of CATEGORIES) {
    assert.ok(
      ["high", "medium", "low"].includes(c.readingSuitability),
      `category "${c.slug}" must have a valid readingSuitability`,
    );
  }
});

test("readingSuitability tier assignments match the documented mapping", () => {
  for (const c of CATEGORIES) {
    assert.equal(
      c.readingSuitability,
      EXPECTED_SUITABILITY[c.slug],
      `category "${c.slug}" tier`,
    );
  }
});

test("readingSuitabilityOf returns tiers and defaults unknown/null to medium", () => {
  assert.equal(readingSuitabilityOf("science"), "high");
  assert.equal(readingSuitabilityOf("business"), "medium");
  assert.equal(readingSuitabilityOf("politics"), "low");
  assert.equal(readingSuitabilityOf("sports"), "low");
  assert.equal(readingSuitabilityOf("not-a-category"), "medium");
  assert.equal(readingSuitabilityOf(null), "medium");
});

test("readingSuitabilityRank maps tiers to high=1.0, medium=0.6, low=0.25", () => {
  assert.equal(readingSuitabilityRank("science"), 1.0);
  assert.equal(readingSuitabilityRank("business"), 0.6);
  assert.equal(readingSuitabilityRank("politics"), 0.25);
  assert.equal(readingSuitabilityRank("not-a-category"), 0.6);
  assert.equal(readingSuitabilityRank(null), 0.6);
});

test("READING_RECOMMENDED_CATEGORIES is the high+medium set and excludes politics+sports", () => {
  assert.ok(!READING_RECOMMENDED_CATEGORIES.includes("politics"));
  assert.ok(!READING_RECOMMENDED_CATEGORIES.includes("sports"));
  for (const [slug, tier] of Object.entries(EXPECTED_SUITABILITY)) {
    assert.equal(
      READING_RECOMMENDED_CATEGORIES.includes(slug),
      tier !== "low",
      `"${slug}" recommended-membership`,
    );
  }
  // exactly the 12 non-low slugs
  assert.equal(READING_RECOMMENDED_CATEGORIES.length, 12);
});

test("isReadingRecommended is true for high/medium/unknown and false for low", () => {
  assert.equal(isReadingRecommended("science"), true);
  assert.equal(isReadingRecommended("business"), true);
  assert.equal(isReadingRecommended("politics"), false);
  assert.equal(isReadingRecommended("sports"), false);
  assert.equal(isReadingRecommended("not-a-category"), true);
  assert.equal(isReadingRecommended(null), true);
});
