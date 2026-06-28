/**
 * Unit tests for the local Naive-Bayes ad/article quality classifier
 * (Issue #739 follow-up).
 *
 * Verifies the committed model labels clear article prose vs. clear ad copy,
 * and that the classifier degrades to a NEUTRAL, no-throw result for short or
 * empty input. No real network or database is touched.
 */

process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyArticleText,
  CLASSIFIER_MIN_WORDS,
  __resetClassifierCacheForTests,
} from "@/lib/scraper/quality-classifier";

const ARTICLE_TEXT =
  "The city council voted on Tuesday to approve a new plan for the downtown district, " +
  "citing growing demand for affordable housing near the transit line. Researchers say " +
  "the change will help many local families over the next several years as the work begins.";

const AD_TEXT =
  "Subscribe now and save 50% off your first order today. Buy now! Click here for the best " +
  "deal. Limited time offer. Sign up today and get free shipping. Shop now before the sale ends.";

test("classifier: clear article prose is labeled 'article' with reasonable confidence", () => {
  __resetClassifierCacheForTests();
  const { label, confidence } = classifyArticleText(ARTICLE_TEXT);

  assert.equal(label, "article");
  assert.ok(confidence >= 0.6, `expected confidence ≥ 0.6, got ${confidence}`);
});

test("classifier: clear ad copy is labeled 'ad' with reasonable confidence", () => {
  const { label, confidence } = classifyArticleText(AD_TEXT);

  assert.equal(label, "ad");
  assert.ok(confidence >= 0.6, `expected confidence ≥ 0.6, got ${confidence}`);
});

test("classifier: short text returns a neutral result and never throws", () => {
  const result = classifyArticleText("buy now");

  assert.equal(result.label, "article");
  assert.equal(result.confidence, 0);
});

test("classifier: empty / whitespace text returns a neutral result", () => {
  assert.deepEqual(classifyArticleText(""), { label: "article", confidence: 0 });
  assert.deepEqual(classifyArticleText("   \n\t  "), { label: "article", confidence: 0 });
});

test(`classifier: text below ${CLASSIFIER_MIN_WORDS} words is neutral`, () => {
  const shortText = Array.from({ length: CLASSIFIER_MIN_WORDS - 1 }, (_, i) => `word${i}`).join(" ");
  const result = classifyArticleText(shortText);

  assert.equal(result.confidence, 0);
});

test("classifier: confidence is always within [0, 1]", () => {
  const { confidence } = classifyArticleText(ARTICLE_TEXT);
  assert.ok(confidence >= 0 && confidence <= 1, `confidence ${confidence} out of range`);
});
