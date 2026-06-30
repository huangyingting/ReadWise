/**
 * Speech timing migration CLI — converts legacy ArticleSpeech.words arrays to
 * the canonical V2 columnar timing payload.
 *
 * Usage:
 *   npm run migrate-speech-timing -- [--limit N] [--provider azure]
 *
 * Safe to re-run: rows already storing V2 objects are skipped.
 */
import { migrateArticleSpeechTimingsToV2 } from "@/lib/speech/timing-migration";
import { runScript, isMain, parseString } from "./lib/cli";

type Args = {
  limit: number | undefined;
  provider: string | undefined;
};

function parseArgs(argv: string[]): Args {
  const limitStr = parseString(argv, "--limit");
  const provider = parseString(argv, "--provider");
  return {
    limit: limitStr !== null ? parseInt(limitStr, 10) : undefined,
    provider: provider ?? undefined,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log(
    "Starting speech timing migration...",
    args.limit ? `(limit ${args.limit})` : "(all rows)",
  );

  const result = await migrateArticleSpeechTimingsToV2({
    limit: args.limit,
    provider: args.provider,
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

if (isMain(import.meta.url)) {
  runScript(main, "Fatal");
}
