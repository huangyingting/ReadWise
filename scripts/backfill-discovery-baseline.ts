/**
 * Discovery baseline seed CLI — initializes the incremental discovery ledger
 * from EXISTING public scraped Articles (issue #1083, Phase 1.3).
 *
 * Reads eligible public provider Articles, normalizes each existing `sourceUrl`
 * with the pure #1082 identity module (NO network fetch), and writes one
 * permanent baseline candidate + provisional alias per unique identity, or one
 * open `CanonicalConflict` per identity claimed by two or more Articles. It never
 * refetches or revives a known Article; every backfilled candidate is marked
 * `observedInBaseline = true`.
 *
 * Usage:
 *   npm run backfill:discovery-baseline               # apply writes
 *   npm run backfill:discovery-baseline -- --dry-run  # report only, zero writes
 *
 * Safe to re-run: writes are keyed on the ledger's unique constraints, so reruns
 * converge with identical final counts and no duplicate rows. Output is metadata
 * only (Article IDs, controlled conflict reason, counts) — never content or URLs.
 */
import {
  BASELINE_IDENTITY_VERSION,
  backfillDiscoveryBaseline,
} from "@/lib/scraper/incremental/baseline-backfill";
import { isMain, runScript } from "./lib/cli";

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

async function main(): Promise<number> {
  const { dryRun } = parseArgs(process.argv.slice(2));

  console.log(
    `Seeding discovery baseline (identity ${BASELINE_IDENTITY_VERSION})${
      dryRun ? " — dry-run, no writes" : ""
    }...`,
  );

  const report = await backfillDiscoveryBaseline({ dryRun });

  console.log(`Eligible public Articles:  ${report.eligibleArticles}`);
  console.log(`Distinct identities:       ${report.identities}`);
  console.log(
    `Candidates:                ${report.candidatesCreated} created, ${report.candidatesExisting} existing${
      dryRun ? " (dry-run, not written)" : ""
    }`,
  );
  console.log(
    `Provisional aliases:       ${report.aliasesCreated} created, ${report.aliasesExisting} existing`,
  );
  console.log(
    `Canonical conflicts:       ${report.conflicts} detected (${report.conflictsCreated} created, ${report.conflictsExisting} existing)`,
  );
  console.log(`Conflicted Articles:       ${report.conflictedArticles} (left unset, failed closed)`);
  console.log(`Skipped Articles:          ${report.skipped.length}`);

  if (report.skipped.length > 0) {
    const byReason = new Map<string, number>();
    for (const skip of report.skipped) {
      byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1);
    }
    for (const [reason, count] of byReason) {
      console.log(`  - ${reason}: ${count}`);
    }
  }

  if (report.conflictDetails.length > 0) {
    console.log("Conflict details (metadata only):");
    for (const detail of report.conflictDetails) {
      console.log(`  - ${detail.reason}: ${detail.articleIds.length} articles [${detail.articleIds.join(", ")}]`);
    }
  }

  if (dryRun) {
    console.log("Dry-run complete. Re-run without --dry-run to apply writes.");
  } else {
    console.log("Baseline seed complete.");
  }
  return 0;
}

export { parseArgs, main };

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "Baseline seed failed");
  }
}

runAsCli();
