import { prisma } from "@/lib/prisma";
import {
  runJobWorker,
  createConsoleLogger,
  type JobWorkerOptions,
} from "@/lib/worker";
import { isAiConfigured } from "@/lib/ai";
import { isSpeechConfigured } from "@/lib/speech";
import { isSupportedLanguage } from "@/lib/translation";

type Args = {
  intervalMs: number;
  once: boolean;
  tts: boolean;
  translateLangs: string[];
  lockTtlMs: number;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    intervalMs: 5000,
    once: false,
    tts: false,
    translateLangs: [],
    lockTtlMs: 600000,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--interval":
        args.intervalMs = Math.max(0, Number(argv[++i]) || 0);
        break;
      case "--jobs":
        // Backward-compatible no-op: the durable Job table is the only worker.
        break;
      case "--lock-ttl":
        args.lockTtlMs = Math.max(0, Number(argv[++i]) || 0);
        break;
      case "--once":
        args.once = true;
        break;
      case "--tts":
        args.tts = true;
        break;
      case "--translate": {
        const value = argv[++i] ?? "";
        for (const code of value.split(",").map((c) => c.trim()).filter(Boolean)) {
          if (!args.translateLangs.includes(code)) args.translateLangs.push(code);
        }
        break;
      }
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        console.warn(`Unknown flag: ${arg}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`ReadWise background processing worker

Continuously drains the durable Job table and enriches articles with AI content
(difficulty, tags, vocabulary, quiz, optional translation + TTS) via the
idempotent processor, retrying transient failures with persisted backoff. Stops
safely on SIGINT/SIGTERM (Ctrl-C) after finishing the current job, and resumes
remaining work on restart.

Usage:
  npm run worker                 Drain the persistent Job table (poll forever)
  npm run worker -- --once       Drain the queue once, then exit
  npm run worker -- --jobs       Explicitly select the persistent Job table

Options:
  --interval <ms>       Idle wait between polls when empty (default 5000)
  --jobs                Backward-compatible no-op; durable Job mode is the only mode
  --lock-ttl <ms>       Stale-lock recovery threshold for --jobs (default 600000)
  --once                Process the queue until empty, then stop
  --tts                 Also generate text-to-speech narration (slow)
  --translate <codes>   Pre-generate translations (comma-separated, e.g. es,fr)
  --help                Show this help`);
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

  const controller = new AbortController();
  const logger = createConsoleLogger();
  let signalled = false;
  const onSignal = (sig: string) => {
    if (signalled) {
      logger.warn(`received ${sig} again — forcing exit`);
      process.exit(130);
    }
    signalled = true;
    logger.info(`received ${sig} — stopping after current article…`);
    controller.abort();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const jobOpts: JobWorkerOptions = {
    pollIntervalMs: args.intervalMs,
    lockTtlMs: args.lockTtlMs,
    once: args.once,
    signal: controller.signal,
    logger,
    process: { tts: args.tts, translateLangs: args.translateLangs },
  };
  await runJobWorker(jobOpts);
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
