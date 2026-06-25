import { prisma } from "@/lib/prisma";
import {
  processArticle,
  listUnprocessedArticleIds,
  type ArticleProcessResult,
  type ProcessOptions,
} from "@/lib/processing/processor";
import { isAiConfigured } from "@/lib/ai";
import { isSpeechConfigured } from "@/lib/speech";
import { isSupportedLanguage } from "@/lib/translation";
import { enqueueArticleProcess } from "@/lib/jobs";
import { runCli, isMain, addUniqueFromCsv, warnUnknown } from "./lib/cli";

type Args = {
  ids: string[];
  all: boolean;
  includePublished: boolean;
  limit: number | null;
  tts: boolean;
  translateLangs: string[];
  enqueue: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    ids: [],
    all: false,
    includePublished: false,
    limit: null,
    tts: false,
    translateLangs: [],
    enqueue: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--all":
        args.all = true;
        break;
      case "--include-published":
        args.includePublished = true;
        break;
      case "--limit":
        args.limit = Math.max(1, Number(argv[++i]) || 1);
        break;
      case "--tts":
        args.tts = true;
        break;
      case "--enqueue":
        args.enqueue = true;
        break;
      case "--translate":
        addUniqueFromCsv(args.translateLangs, argv[++i] ?? "");
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          warnUnknown(arg);
        } else {
          args.ids.push(arg);
        }
    }
  }
  return args;
}

export { parseArgs };

function printHelp(): void {
  console.log(`ReadWise article processor

Enriches articles with AI content (difficulty, tags, vocabulary, quiz, optional
translation + TTS) and publishes drafts once enrichment completes. Idempotent:
already-completed steps are skipped.

Usage:
  npm run process -- <id> [<id> ...]      Process specific article ids
  npm run process -- --all                Process all unprocessed (draft) articles
  npm run process -- --all --enqueue      Enqueue durable ARTICLE_PROCESS jobs
  npm run process -- --all --include-published
                                          Also enrich published articles missing content

Options:
  --limit N             Cap the number of articles processed in --all mode
  --tts                 Also generate text-to-speech narration (slow)
  --translate <codes>   Pre-generate translations (comma-separated, e.g. es,fr)
  --enqueue             Enqueue durable jobs instead of processing inline
  --help                Show this help`);
}

function summarize(result: ArticleProcessResult): void {
  const icon = result.ok ? (result.published ? "✓" : "•") : "✗";
  console.log(`${icon} ${result.title}`);
  console.log(`    id=${result.articleId} published=${result.published}`);
  for (const step of result.steps) {
    const detail = step.detail ? ` — ${step.detail}` : "";
    console.log(`      ${step.status.padEnd(9)} ${step.step}${detail}`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  for (const lang of args.translateLangs) {
    if (!isSupportedLanguage(lang)) {
      console.error(`Unsupported translation language: "${lang}".`);
      return 1;
    }
  }

  if (!isAiConfigured()) {
    console.warn(
      "⚠ Azure OpenAI is not configured — AI steps will fall back gracefully (no vocab/quiz/tags). Difficulty still uses the heuristic.",
    );
  }
  if (args.tts && !isSpeechConfigured()) {
    console.warn("⚠ Azure Speech is not configured — TTS will fall back gracefully.");
  }

  let ids: string[] = args.ids;
  if (args.all) {
    const discovered = await listUnprocessedArticleIds({
      includePublished: args.includePublished,
      limit: args.limit ?? undefined,
    });
    ids = [...new Set([...ids, ...discovered])];
  } else if (ids.length === 0) {
    printHelp();
    return 0;
  }

  if (ids.length === 0) {
    console.log("No unprocessed articles found.");
    return 0;
  }

  const opts: ProcessOptions = {
    tts: args.tts,
    translateLangs: args.translateLangs,
  };

  if (args.enqueue) {
    console.log(`Enqueuing ${ids.length} ARTICLE_PROCESS job(s)…\n`);
    let enqueued = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const job = await enqueueArticleProcess(id, opts);
        console.log(`✓ ${id} → job ${job.id} (${job.status})`);
        enqueued++;
      } catch (err) {
        console.error(`✗ could not enqueue ${id}: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }
    console.log(`\nDone. enqueued=${enqueued} failed=${failed}`);
    console.log("Run `npm run worker` to drain the durable Job queue.");
    return failed > 0 ? 1 : 0;
  }

  console.log(`Processing ${ids.length} article(s)…\n`);

  let published = 0;
  let failed = 0;
  let missing = 0;
  for (const id of ids) {
    const result = await processArticle(id, opts);
    if (!result) {
      console.log(`✗ article not found: ${id}`);
      missing++;
      continue;
    }
    summarize(result);
    if (!result.ok) failed++;
    if (result.published) published++;
  }

  console.log(
    `\nDone. processed=${ids.length} published=${published} failed=${failed} missing=${missing}`,
  );
  return failed > 0 || missing > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  runCli(main);
}
