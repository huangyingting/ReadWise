/**
 * Storage migration CLI — moves ArticleSpeech.audioBase64 payloads into the
 * configured object-storage backend (MEDIA_STORAGE=filesystem|azure|...).
 *
 * Usage:
 *   npm run migrate-storage -- [--limit N]
 *
 * Safe to re-run: only rows WITH base64 AND WITHOUT a storageKey are eligible.
 * Base64 is cleared ONLY after the storage write and MediaAsset record succeed.
 */
import { migrateArticleSpeechToStorage } from "@/lib/storage";

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit =
    limitIdx >= 0 && args[limitIdx + 1]
      ? parseInt(args[limitIdx + 1]!, 10)
      : undefined;

  console.log("Starting storage migration...", limit ? `(limit ${limit})` : "(all eligible)");

  const result = await migrateArticleSpeechToStorage({ limit });

  if (result.skippedNoStorage) {
    console.log(
      "Skipped: no object storage configured (MEDIA_STORAGE is database/unset).",
    );
    console.log("Set MEDIA_STORAGE=filesystem or MEDIA_STORAGE=azure and configure credentials.");
    process.exit(0);
  }

  console.log(`Storage kind: ${result.storageKind}`);
  console.log(`Scanned:          ${result.scanned}`);
  console.log(`Migrated:         ${result.migrated}`);
  console.log(`Already migrated: ${result.alreadyMigrated}`);
  console.log(`Failed:           ${result.failed}`);

  if (result.failed > 0) {
    console.error(`${result.failed} row(s) failed — check logs for details.`);
    process.exit(1);
  }

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
