/**
 * One-time speech import migration CLI.
 *
 * Imports external speech data into ReadWise's native ArticleSpeech shape:
 * { word, offset, duration } timings plus canonical plainText.
 *
 * Usage:
 *   npm run migrate-speech -- --input ./speech-export.json --audio-dir ./data/tts --dry-run
 *   npm run migrate-speech -- --input ./speech-export.json --audio-dir ./data/tts --overwrite
 *
 * Expected JSON export shape:
 *   [
 *     {
 *       "originalUrl": "https://example.com/article",
 *       "audioUrl": "abc.mp3",
 *       "mimeType": "audio/mpeg",
 *       "wordTimings": [{ "word": "Hello", "offset": 0, "duration": 250 }]
 *     }
 *   ]
 *
 * `audioUrl` may be a data URI, or a filename relative to --audio-dir. When
 * overwriting an existing ReadWise speech row, existing audio storage is
 * preserved and only plainText/words are rewritten.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { htmlToPlainText } from "@/lib/translation";
import type { WordTiming } from "@/lib/speech-timing";

const DEFAULT_VOICE = "speech-import";
const DEFAULT_FORMAT = "speech-import";

type SpeechExportRow = {
  readWiseArticleId?: unknown;
  originalUrl?: unknown;
  sourceUrl?: unknown;
  canonicalUrl?: unknown;
  title?: unknown;
  audioUrl?: unknown;
  audioBase64?: unknown;
  mimeType?: unknown;
  voice?: unknown;
  wordTimings?: unknown;
};

type CliOptions = {
  input: string;
  audioDir?: string;
  dryRun: boolean;
  overwrite: boolean;
  limit?: number;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run migrate-speech -- --input <export.json> [--audio-dir ./data/tts] [--dry-run] [--overwrite] [--limit N]",
    "",
    "Notes:",
    "  - The export must contain speech rows plus an article URL or readWiseArticleId.",
    "  - wordTimings are stored as { word, offset, duration } rows.",
    "  - --overwrite preserves existing ReadWise audio storage and rewrites plainText/words.",
    "  - The script logs counts only; it does not print article text or timing payloads.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  let input = "";
  let audioDir: string | undefined;
  let dryRun = false;
  let overwrite = false;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") {
      input = argv[++i] ?? "";
    } else if (arg === "--audio-dir") {
      audioDir = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--limit") {
      const value = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--limit must be a positive integer");
      limit = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!input) throw new Error("Missing required --input <export.json>");

  return { input, audioDir, dryRun, overwrite, limit };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWordTimings(value: unknown): WordTiming[] | null {
  if (!Array.isArray(value)) return null;

  const timings: WordTiming[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const word = stringValue(record.word) ?? stringValue(record.Text);
    const offset = typeof record.offset === "number" ? record.offset : record.AudioOffset;
    const duration = typeof record.duration === "number" ? record.duration : record.Duration;

    if (
      !word ||
      typeof offset !== "number" ||
      !Number.isFinite(offset) ||
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      offset < 0 ||
      duration < 0
    ) {
      return null;
    }

    timings.push({ word, offset, duration });
  }

  return timings;
}

function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  return "audio/mpeg";
}

function parseDataUri(value: string): { mimeType: string; audioBase64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value);
  if (!match) return null;
  return { mimeType: match[1], audioBase64: match[2] };
}

async function readAudio(row: SpeechExportRow, audioDir?: string): Promise<{ mimeType: string; audioBase64: string } | null> {
  const rawBase64 = stringValue(row.audioBase64);
  const audioUrl = stringValue(row.audioUrl);
  const explicitMime = stringValue(row.mimeType);

  if (rawBase64) {
    const parsed = parseDataUri(rawBase64);
    if (parsed) return parsed;
    return { mimeType: explicitMime ?? "audio/mpeg", audioBase64: rawBase64 };
  }

  if (!audioUrl) return null;

  const parsedUrl = parseDataUri(audioUrl);
  if (parsedUrl) return parsedUrl;
  if (!audioDir) return null;

  const baseDir = path.resolve(audioDir);
  const audioPath = path.resolve(baseDir, audioUrl);
  if (!audioPath.startsWith(`${baseDir}${path.sep}`) && audioPath !== baseDir) {
    throw new Error(`Refusing to read audio outside --audio-dir: ${audioUrl}`);
  }

  const bytes = await readFile(audioPath);
  return {
    mimeType: explicitMime ?? mimeTypeFromPath(audioPath),
    audioBase64: bytes.toString("base64"),
  };
}

async function findArticle(row: SpeechExportRow) {
  const readWiseArticleId = stringValue(row.readWiseArticleId);
  if (readWiseArticleId) {
    return prisma.article.findUnique({
      where: { id: readWiseArticleId },
      select: { id: true, content: true },
    });
  }

  const urls = [row.originalUrl, row.sourceUrl, row.canonicalUrl]
    .map(stringValue)
    .filter((value): value is string => Boolean(value));

  if (urls.length > 0) {
    return prisma.article.findFirst({
      where: {
        OR: urls.flatMap((url) => [{ sourceUrl: url }, { canonicalUrl: url }]),
      },
      select: { id: true, content: true },
    });
  }

  const title = stringValue(row.title);
  if (title) {
    return prisma.article.findFirst({
      where: { title },
      select: { id: true, content: true },
    });
  }

  return null;
}

async function loadExport(inputPath: string): Promise<SpeechExportRow[]> {
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Speech export must be a JSON array");
  }
  return payload as SpeechExportRow[];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await loadExport(options.input);
  const selectedRows = options.limit ? rows.slice(0, options.limit) : rows;

  let scanned = 0;
  let migrated = 0;
  let skippedNoArticle = 0;
  let skippedExisting = 0;
  let skippedMalformed = 0;
  let skippedAudio = 0;

  for (const row of selectedRows) {
    scanned += 1;

    const article = await findArticle(row);
    if (!article) {
      skippedNoArticle += 1;
      continue;
    }

    const existing = await prisma.articleSpeech.findUnique({
      where: { articleId: article.id },
      select: { id: true },
    });
    if (existing && !options.overwrite) {
      skippedExisting += 1;
      continue;
    }

    const timings = normalizeWordTimings(row.wordTimings);
    if (!timings || timings.length === 0) {
      skippedMalformed += 1;
      continue;
    }

    const audio = existing ? null : await readAudio(row, options.audioDir);
    if (!existing && !audio) {
      skippedAudio += 1;
      continue;
    }

    const plainText = htmlToPlainText(article.content);
    const words = timings.sort((a, b) => a.offset - b.offset);

    if (!options.dryRun) {
      if (existing) {
        await prisma.articleSpeech.update({
          where: { articleId: article.id },
          data: {
            plainText,
            words,
          },
        });
      } else if (audio) {
        await prisma.articleSpeech.create({
          data: {
            articleId: article.id,
            voice: stringValue(row.voice) ?? DEFAULT_VOICE,
            format: DEFAULT_FORMAT,
            mimeType: audio.mimeType,
            audioBase64: audio.audioBase64,
            plainText,
            words,
          },
        });
      }
    }

    migrated += 1;
  }

  console.log(options.dryRun ? "Speech migration dry run complete." : "Speech migration complete.");
  console.log(`Scanned:          ${scanned}`);
  console.log(`Migrated:         ${migrated}`);
  console.log(`No article match: ${skippedNoArticle}`);
  console.log(`Existing skipped: ${skippedExisting}`);
  console.log(`Malformed rows:   ${skippedMalformed}`);
  console.log(`Missing audio:    ${skippedAudio}`);

  if (skippedMalformed > 0 || skippedAudio > 0) {
    console.log("Some rows were skipped; review the counts above if full coverage is required.");
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
