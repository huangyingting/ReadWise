import { prisma } from "@/lib/prisma";
import { runSeed, DEFAULT_SEED_LIMIT, type SeedOptions, type SeedStats } from "@/lib/seed";
import { PROVIDERS } from "@/lib/scraper/providers";
import { isAiConfigured } from "@/lib/ai";
import { isSpeechConfigured } from "@/lib/speech";
import { isSupportedLanguage } from "@/lib/translation";
import { runCli, isMain, addUniqueFromCsv, warnUnknown } from "./lib/cli";

type Args = {
  providers: string[];
  limit: number;
  tts: boolean;
  translateLangs: string[];
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    providers: [],
    limit: DEFAULT_SEED_LIMIT,
    tts: true,
    translateLangs: [],
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--provider":
        addUniqueFromCsv(args.providers, argv[++i] ?? "");
        break;
      case "--all":
        args.providers = ["all"];
        break;
      case "--limit":
        args.limit = Math.max(1, Number(argv[++i]) || DEFAULT_SEED_LIMIT);
        break;
      case "--no-tts":
        args.tts = false;
        break;
      case "--tts":
        args.tts = true;
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
          if (!args.providers.includes(arg)) args.providers.push(arg);
        }
    }
  }
  return args;
}

export { parseArgs };

function printHelp(): void {
  console.log(`ReadWise database seeder

Populates the database with enriched sample articles in one command: scrapes a
provider for sample articles, then runs the full AI enrichment pipeline
(difficulty, tags, vocabulary, quiz, optional translation) plus TTS narration on
each. Idempotent — re-running never creates duplicate articles or regenerates
already-enriched content.

Usage:
  npm run seed                          Seed from the default provider (${PROVIDERS[0].name})
  npm run seed -- --provider <key>      Seed from a specific provider
  npm run seed -- --all                 Seed from every provider
  npm run seed -- --provider nbc,time   Seed from multiple providers

Options:
  --limit N             Max articles to scrape per provider (default ${DEFAULT_SEED_LIMIT})
  --no-tts              Skip text-to-speech narration (faster)
  --translate <codes>   Also pre-generate translations (comma-separated, e.g. es,fr)
  --help                Show this help

Providers: ${PROVIDERS.map((p) => p.key).join(", ")}`);
}

function summarize(stats: SeedStats): void {
  console.log(
    `\nDone. discovered=${stats.discovered} saved=${stats.saved} duplicates=${stats.duplicates} ` +
      `enriched=${stats.enriched} published=${stats.published} failed=${stats.failed}`,
  );
  if (stats.articleIds.length > 0) {
    console.log(`Seeded article ids: ${stats.articleIds.join(", ")}`);
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

  const options: SeedOptions = {
    providerKeys: args.providers.length > 0 ? args.providers : undefined,
    limit: args.limit,
    tts: args.tts,
    translateLangs: args.translateLangs,
    logger: {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    },
  };

  const stats = await runSeed(options);
  summarize(stats);

  return stats.failed > 0 && stats.published === 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  runCli(main);
}
