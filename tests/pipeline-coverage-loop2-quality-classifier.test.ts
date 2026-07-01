process.env.LOG_LEVEL = "error";

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { __resetClassifierCacheForTests, classifyArticleText } from "@/lib/scraper/quality-classifier";

const require = createRequire(import.meta.url);
const natural = require("natural") as {
  BayesClassifier: {
    restore: (model: unknown) => { getClassifications(text: string): Array<{ label: string; value: number }> };
  };
};
const originalRestore = natural.BayesClassifier.restore;

afterEach(() => {
  natural.BayesClassifier.restore = originalRestore;
  __resetClassifierCacheForTests();
});

const longText = Array.from({ length: 24 }, (_, i) => `word${i}`).join(" ");

test("classifyArticleText degrades to neutral when the local model cannot load", () => {
  natural.BayesClassifier.restore = () => {
    throw new Error("restore failed");
  };
  __resetClassifierCacheForTests();

  assert.deepEqual(classifyArticleText(longText), { label: "article", confidence: 0 });
  assert.deepEqual(classifyArticleText(longText), { label: "article", confidence: 0 });
});

test("classifyArticleText degrades to neutral when classifier execution throws", () => {
  natural.BayesClassifier.restore = () => ({
    getClassifications() {
      throw new Error("classification failed");
    },
  });
  __resetClassifierCacheForTests();

  assert.deepEqual(classifyArticleText(longText), { label: "article", confidence: 0 });
});
