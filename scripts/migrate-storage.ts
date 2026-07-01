/**
 * Storage migration CLI — moves ArticleSpeech.audioBase64 payloads into the
 * configured object-storage backend (MEDIA_STORAGE=filesystem|azure).
 *
 * Usage:
 *   npm run migrate-storage -- [--limit N]
 *
 * Safe to re-run: only rows WITH base64 AND WITHOUT a storageKey are eligible.
 * Base64 is cleared ONLY after the storage write and MediaAsset record succeed.
 */
import { migrateArticleSpeechToStorage } from "@/lib/storage";
import { runScript, isMain, parseString } from "./lib/cli";

type Args = {
  limit: number | undefined;
};

function parseArgs(argv: string[]): Args {
  const limitStr = parseString(argv, "--limit");
  return {
    limit: limitStr !== null ? parseInt(limitStr, 10) : undefined,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log("Starting storage migration...", args.limit ? `(limit ${args.limit})` : "(all eligible)");

  const result = await migrateArticleSpeechToStorage({ limit: args.limit });

  if (result.skippedNoStorage) {
    console.log(
      "Skipped: no object storage configured (MEDIA_STORAGE is database/unset).",
    );
    console.log("Set MEDIA_STORAGE=filesystem or MEDIA_STORAGE=azure and configure credentials.");
    return 0;
  }

  console.log(`Storage kind: ${result.storageKind}`);
  console.log(`Scanned:          ${result.scanned}`);
  console.log(`Migrated:         ${result.migrated}`);
  console.log(`Failed:           ${result.failed}`);

  if (result.failed > 0) {
    console.error(`${result.failed} row(s) failed — check logs for details.`);
    return 1;
  }

  console.log("Migration complete.");
  return 0;
}

export { main, parseArgs };

if (isMain(import.meta.url)) {
  runScript(main, "Fatal");
}
