/**
 * Discovery-canary reconciliation CLI (issue #1090, Phase 1.10).
 *
 * Compares a canary source's LEDGER observations (`DiscoveryObservation`) against
 * a CONTROLLED provider-published sample (a JSON file of SANITIZED identity keys)
 * and reports the metadata-only reconciliation — hits, explained misses,
 * UNEXPLAINED misses, and extras. The pure comparison lives in the testable
 * `reconciliation.ts` module; this script is a thin runner that only assembles
 * the two sets from metadata-only reads and prints counts.
 *
 * Output is METADATA ONLY: sanitized identity keys, counts, and sanitized
 * category labels — NEVER article content or a raw URL (AC4). The sample file is
 * itself sanitized identity keys, not URLs.
 *
 * Usage:
 *   npm run reconcile:discovery-canary -- --source <sourceId> --sample <path.json>
 *
 * Sample file shape:
 *   { "items": [ { "identityKey": "v1:<hex>", "expectedObservable": true,
 *                  "category": "science" }, ... ] }
 */
import { readFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";

import {
  reconcile,
  type ReconciliationLedgerEntry,
  type ReconciliationSampleItem,
} from "@/lib/scraper/incremental/reconciliation";
import { isMain, runScript } from "./lib/cli";

export type ReconcileArgs = { sourceId: string; samplePath: string };

export function parseArgs(argv: string[]): ReconcileArgs {
  let sourceId = "";
  let samplePath = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") sourceId = argv[++i] ?? "";
    else if (argv[i] === "--sample") samplePath = argv[++i] ?? "";
  }
  if (!sourceId || !samplePath) {
    throw new Error("usage: reconcile:discovery-canary -- --source <sourceId> --sample <path.json>");
  }
  return { sourceId, samplePath };
}

/** Reads a controlled sample file into sanitized sample items. */
export async function readSample(samplePath: string): Promise<ReconciliationSampleItem[]> {
  const raw = await readFile(samplePath, "utf8");
  const parsed = JSON.parse(raw) as { items?: ReconciliationSampleItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/** Reads a source's ledger observations as sanitized identity keys. */
export async function readLedgerEntries(sourceId: string): Promise<ReconciliationLedgerEntry[]> {
  const rows = await prisma.discoveryObservation.findMany({
    where: { discoverySourceId: sourceId },
    select: { observationKey: true },
  });
  return rows.map((row) => ({ identityKey: row.observationKey }));
}

export async function main(): Promise<number> {
  const { sourceId, samplePath } = parseArgs(process.argv.slice(2));
  const [sample, ledger] = await Promise.all([readSample(samplePath), readLedgerEntries(sourceId)]);
  const result = reconcile(sample, ledger);

  console.log(`Reconciliation for source ${sourceId} (metadata only):`);
  console.log(`  Sample size:        ${result.sampleSize}`);
  console.log(`  Ledger size:        ${result.ledgerSize}`);
  console.log(`  Hits:               ${result.hits}`);
  console.log(`  Explained misses:   ${result.explainedMisses}`);
  console.log(`  Unexplained misses: ${result.unexplainedMisses}`);
  console.log(`  Extras:             ${result.extras}`);
  if (result.unexplainedMisses > 0) {
    console.log(`  Unexplained miss ids: [${result.unexplainedMissIds.join(", ")}]`);
  }
  // Non-zero exit code when unexplained misses exist (the gate-breaking case).
  return result.unexplainedMisses === 0 ? 0 : 1;
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "Discovery canary reconciliation failed");
  }
}

runAsCli();
