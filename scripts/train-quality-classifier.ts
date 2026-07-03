/**
 * Trains the local Naive-Bayes ad/article quality classifier and writes the
 * committed model JSON (Issue #739 follow-up).
 *
 * Builds a `natural.BayesClassifier` from the hand-curated seed corpus in
 * `src/lib/scraper/quality-classifier-corpus.ts` and serializes it to
 * `src/lib/scraper/quality-classifier-model.json`, which is loaded at runtime
 * by `src/lib/scraper/quality-classifier.ts`.
 *
 * Run with:
 *   npm run node-ts -- scripts/train-quality-classifier.ts
 *
 * The produced model is a "bootstrapped" / heuristic-aligned classifier — good
 * enough as a complementary quality signal. Re-run this script and commit the
 * regenerated JSON whenever the seed corpus changes.
 *
 * @server-only — training/build-time utility; not imported by app runtime.
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ARTICLE_SAMPLES, AD_SAMPLES } from "@/lib/scraper/quality-classifier-corpus";

const require = createRequire(import.meta.url);

type BayesClassifier = {
  addDocument(text: string, label: string): void;
  train(): void;
};
type NaturalModule = { BayesClassifier: new () => BayesClassifier };

const ARTICLE_LABEL = "article";
const AD_LABEL = "ad";
const MODEL_OUTPUT_PATH = "../src/lib/scraper/quality-classifier-model.json";

function trainClassifier(natural: NaturalModule): BayesClassifier {
  const classifier = new natural.BayesClassifier();

  for (const sample of ARTICLE_SAMPLES) classifier.addDocument(sample, ARTICLE_LABEL);
  for (const sample of AD_SAMPLES) classifier.addDocument(sample, AD_LABEL);

  classifier.train();
  return classifier;
}

function resolveOutputPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, MODEL_OUTPUT_PATH);
}

function main(): void {
  const natural = require("natural") as NaturalModule;
  const classifier = trainClassifier(natural);
  const outPath = resolveOutputPath();

  // `BayesClassifier` is JSON-serializable; `JSON.stringify` captures the full
  // trained state that `BayesClassifier.restore` expects.
  const serialized = JSON.stringify(classifier, null, 2);
  writeFileSync(outPath, serialized + "\n", "utf8");

  console.log(
    `Trained quality classifier: ${ARTICLE_SAMPLES.length} article + ${AD_SAMPLES.length} ad samples → ${outPath}`,
  );
}

main();
