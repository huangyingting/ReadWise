/**
 * Speech timing migration CLI — converts legacy ArticleSpeech.words arrays to
 * the canonical V2 columnar timing payload (default) or compact V1 columnar
 * payload (opt-in with `--target v1`).
 *
 * Also provides `--repair-spans` mode: repairs V2 rows that are missing their
 * textStart/textEnd span arrays using article-derived reader text without
 * re-synthesis.
 *
 * Usage:
 *   npm run migrate-speech-timing -- [--limit N] [--provider azure] [--target v1|v2]
 *   npm run migrate-speech-timing -- --repair-spans [--ids id1,id2] [--limit N] [--apply]
 *
 * Safe to re-run: rows already storing object payloads are skipped.
 */
import {
  migrateArticleSpeechTimings,
  repairSpeechTimingSpans,
} from "@/lib/speech/timing-migration";
import { runScript, isMain, parseString } from "./lib/cli";

type MigrateArgs = {
  mode: "migrate";
  limit: number | undefined;
  provider: string | undefined;
  target: "v1" | "v2";
};

type RepairArgs = {
  mode: "repair-spans";
  ids: string[];
  limit: number | undefined;
  apply: boolean;
};

type Args = MigrateArgs | RepairArgs;

function parseOptionalInt(value: string | null): number | undefined {
  return value !== null ? parseInt(value, 10) : undefined;
}

function parseArgs(argv: string[]): Args {
  const repairSpans = argv.includes("--repair-spans");

  if (repairSpans) {
    const idsCsv = parseString(argv, "--ids");
    const ids = idsCsv ? idsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const limitStr = parseString(argv, "--limit");
    return {
      mode: "repair-spans",
      ids,
      limit: parseOptionalInt(limitStr),
      apply: argv.includes("--apply"),
    };
  }

  const limitStr = parseString(argv, "--limit");
  const provider = parseString(argv, "--provider");
  const targetRaw = parseString(argv, "--target");
  if (targetRaw !== null && targetRaw !== "v1" && targetRaw !== "v2") {
    throw new Error(`Invalid --target: "${targetRaw}". Use v1 or v2.`);
  }
  const target: "v1" | "v2" = targetRaw === "v1" ? "v1" : "v2";
  return {
    mode: "migrate",
    limit: parseOptionalInt(limitStr),
    provider: provider ?? undefined,
    target,
  };
}

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "repair-spans") {
    const dryRun = !args.apply;
    console.log(
      `Starting speech span repair (${dryRun ? "dry-run" : "apply"})...`,
      args.ids.length > 0 ? `(ids: ${args.ids.length})` : "(all rows missing spans)",
      args.limit ? `(limit ${args.limit})` : "",
    );

    const result = await repairSpeechTimingSpans({
      dryRun,
      ids: args.ids.length > 0 ? args.ids : undefined,
      limit: args.limit,
    });

    console.log(`Scanned:               ${result.scanned}`);
    console.log(`Repaired:              ${result.repaired}${dryRun ? " (dry-run, not written)" : ""}`);
    console.log(`Skipped (has spans):   ${result.skippedHasSpans}`);
    console.log(`Skipped (no text):     ${result.skippedNoPlainText}`);
    console.log(`Skipped (unresolved):  ${result.skippedAlignment}`);
    console.log(`Failed:                ${result.failed}`);

    if (result.failed > 0) {
      console.error(`${result.failed} row(s) failed — check logs for details.`);
      return 1;
    }

    if (dryRun && result.repaired > 0) {
      console.log(`Dry-run complete. Re-run with --apply to write ${result.repaired} row(s).`);
    } else {
      console.log("Span repair complete.");
    }
    return 0;
  }

  // Default: legacy migration mode
  console.log(
    `Starting speech timing migration (target: ${args.target})...`,
    args.limit ? `(limit ${args.limit})` : "(all rows)",
  );

  const result = await migrateArticleSpeechTimings({
    limit: args.limit,
    provider: args.provider,
    target: args.target,
  });

  console.log(`Scanned:          ${result.scanned}`);
  console.log(`Migrated:         ${result.migrated}`);
  console.log(`Skipped current:  ${result.skippedCurrent}`);
  console.log(`Failed:           ${result.failed}`);

  if (result.failed > 0) {
    console.error(`${result.failed} row(s) failed — check logs for details.`);
    return 1;
  }

  console.log("Migration complete.");
  return 0;
}

export { parseArgs };

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "Fatal");
  }
}

runAsCli();
