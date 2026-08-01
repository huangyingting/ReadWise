import {
  runJobWorker,
  createConsoleLogger,
  type JobWorkerOptions,
} from "@/lib/worker";
import { DEFAULT_LOCK_TTL_MS, MIN_LOCK_TTL_MS } from "@/lib/jobs/types";
import { fetchProductionDiscoveryPage } from "@/lib/scraper/incremental/production-discovery";
import { syncCanaryDiscoverySources } from "@/lib/scraper/incremental/canary-registry";
import { isAiConfigured } from "@/lib/ai";
import { isSpeechConfigured } from "@/lib/speech";
import { isSupportedLanguage } from "@/lib/translation";
import { runCli, isMain, addUniqueFromCsv, warnUnknown, registerShutdownSignals } from "./lib/cli";

type Args = {
  intervalMs: number;
  once: boolean;
  tts: boolean;
  translateLangs: string[];
  lockTtlMs: number;
  help: boolean;
};

const DEFAULT_ARGS: Args = {
  intervalMs: 5000,
  once: false,
  tts: false,
  translateLangs: [],
  lockTtlMs: DEFAULT_LOCK_TTL_MS,
  help: false,
};

function parseNonNegativeMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function parseLockTtlMs(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= MIN_LOCK_TTL_MS
    ? parsed
    : DEFAULT_ARGS.lockTtlMs;
}

function optionValue(argv: string[], index: number): string | undefined {
  const value = argv[index + 1];
  if (value === undefined) return undefined;
  if (value.startsWith("-") && !Number.isFinite(Number(value))) return undefined;
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { ...DEFAULT_ARGS, translateLangs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--interval": {
        const value = optionValue(argv, i);
        if (value !== undefined) i++;
        args.intervalMs = parseNonNegativeMs(value, DEFAULT_ARGS.intervalMs);
        break;
      }
      case "--lock-ttl": {
        const value = optionValue(argv, i);
        if (value !== undefined) i++;
        args.lockTtlMs = parseLockTtlMs(value);
        break;
      }
      case "--once":
        args.once = true;
        break;
      case "--tts":
        args.tts = true;
        break;
      case "--translate": {
        const value = optionValue(argv, i);
        if (value !== undefined) i++;
        addUniqueFromCsv(args.translateLangs, value ?? "");
        break;
      }
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        warnUnknown(arg);
    }
  }
  return args;
}

export { main, parseArgs };

function printHelp(): void {
  console.log(`ReadWise background processing worker

Continuously drains the durable Job table and enriches articles with AI content
(difficulty, tags, vocabulary, quiz, optional translation + TTS) via the
idempotent processor, retrying transient failures with persisted backoff. Stops
safely on SIGINT/SIGTERM (Ctrl-C) by asking current work to abort cooperatively;
unfinished durable work is reclaimed after its lease expires.

Usage:
  npm run worker                 Drain the persistent Job table (poll forever)
  npm run worker -- --once       Drain the queue once, then exit

Options:
  --interval <ms>       Idle wait between polls when empty (default 5000)
  --lock-ttl <ms>       Stale-lock recovery threshold (default 600000; minimum 60000)
  --once                Process the queue until empty, then stop
  --tts                 Also generate text-to-speech narration (slow)
  --translate <codes>   Pre-generate translations (comma-separated, e.g. es,fr)
  --help                Show this help`);
}

function validateTranslateLangs(langs: string[]): boolean {
  for (const lang of langs) {
    if (!isSupportedLanguage(lang)) {
      console.error(`Unsupported translation language: "${lang}".`);
      return false;
    }
  }
  return true;
}

function buildJobWorkerOptions(
  args: Args,
  controller: AbortController,
  logger: ReturnType<typeof createConsoleLogger>,
): JobWorkerOptions {
  return {
    pollIntervalMs: args.intervalMs,
    lockTtlMs: args.lockTtlMs,
    once: args.once,
    signal: controller.signal,
    logger,
    process: { tts: args.tts, translateLangs: args.translateLangs },
    discovery: { fetchPage: fetchProductionDiscoveryPage },
    backfill: true,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  if (!validateTranslateLangs(args.translateLangs)) {
    return 1;
  }

  if (!isAiConfigured()) {
    console.warn(
      "⚠ Azure OpenAI is not configured — AI steps will fall back gracefully (no vocab/quiz/tags). Difficulty is deterministic and still runs.",
    );
  }
  if (args.tts && !isSpeechConfigured()) {
    console.warn("⚠ Azure Speech is not configured — TTS will fall back gracefully.");
  }

  const controller = new AbortController();
  const logger = createConsoleLogger();
  registerShutdownSignals(controller, logger);

  const registry = await syncCanaryDiscoverySources();
  logger.info("discovery source registry synced", { sources: registry.synced });

  await runJobWorker(buildJobWorkerOptions(args, controller, logger));
  return 0;
}

if (isMain(import.meta.url)) {
  runCli(main);
}
