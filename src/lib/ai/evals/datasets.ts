/**
 * Dataset path resolution and loading for the AI evaluation harness.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalDataset } from "@/lib/ai/evals/types";

const JSON_DATASET_EXTENSION = ".json";

/** Absolute path to the curated evaluation datasets directory. */
export function evalDatasetsDir(): string {
  // <root>/src/lib/ai/evals/datasets.ts → <root>/evals
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..", "evals");
}

function isJsonDatasetFile(file: string): boolean {
  return file.endsWith(JSON_DATASET_EXTENSION);
}

function parseEvalDataset(file: string, raw: string): EvalDataset {
  const parsed = JSON.parse(raw) as EvalDataset;
  if (!parsed.feature || !Array.isArray(parsed.cases)) {
    throw new Error(`Invalid eval dataset: ${file}`);
  }
  return parsed;
}

/** Loads and parses every `*.json` dataset from the evals directory. */
export function loadEvalDatasets(dir: string = evalDatasetsDir()): EvalDataset[] {
  const files = readdirSync(dir)
    .filter(isJsonDatasetFile)
    .sort();
  return files.map((file) => {
    const raw = readFileSync(path.join(dir, file), "utf8");
    return parseEvalDataset(file, raw);
  });
}
