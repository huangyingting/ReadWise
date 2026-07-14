/**
 * Speech timing migration CLI — converts legacy ArticleSpeech.words arrays to
 * the canonical V2 columnar timing payload (default) or compact V1 columnar
 * payload (opt-in with `--target v1`).
 *
 * Usage:
 *   npm run migrate-speech-timing -- [--limit N] [--provider azure] [--target v1|v2]
 *
 * Safe to re-run: rows already storing object payloads are skipped.
 */
import { migrateArticleSpeechTimings } from "@/lib/speech/timing-migration";
import { runScript, isMain, parseString } from "./lib/cli";

type Args = {
  limit: number | undefined;
  provider: string | undefined;
  target: "v1" | "v2";
};

function parseOptionalInt(value: string | null): number | undefined {
  return value !== null ? parseInt(value, 10) : undefined;
}

function parseArgs(argv: string[]): Args {
  const limitStr = parseString(argv, "--limit");
  const provider = parseString(argv, "--provider");
  const targetRaw = parseString(argv, "--target");
  if (targetRaw !== null && targetRaw !== "v1" && targetRaw !== "v2") {
    throw new Error(`Invalid --target: "${targetRaw}". Use v1 or v2.`);
  }
  const target: "v1" | "v2" = targetRaw === "v1" ? "v1" : "v2";
  return {
    limit: parseOptionalInt(limitStr),
    provider: provider ?? undefined,
    target,
  };
}

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

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
