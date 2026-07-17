import { ArticleStatus } from "@prisma/client";

import { isTtsFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { speechConfig } from "@/lib/runtime-config/speech";
import {
  AZURE_BATCH_HD_VOICES,
  AZURE_BATCH_MAX_INPUTS_PER_JOB,
  AZURE_BATCH_MAX_PAYLOAD_BYTES,
  DEFAULT_AZURE_BATCH_JOB_PREFIX,
  runAzureBatchSynthesis,
} from "@/lib/speech/azure-batch-synthesis";
import { createConsoleLogger } from "@/lib/worker";

import { addUniqueFromCsv, isMain, registerShutdownSignals, runCli, warnUnknown } from "./lib/cli";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 168;
const DEFAULT_BREAK_MS = 450;
const DEFAULT_MAX_PAYLOAD_BYTES = AZURE_BATCH_MAX_PAYLOAD_BYTES;
const DEFAULT_MAX_INPUTS_PER_JOB = AZURE_BATCH_MAX_INPUTS_PER_JOB;
const LOWEST_STORAGE_FORMAT = "audio-16khz-32kbitrate-mono-mp3";
const DEFAULT_WEB_LOW_STORAGE_FORMAT = LOWEST_STORAGE_FORMAT;
const DEFAULT_LOOP_SLEEP_MS = 60_000;
const DEFAULT_LOOP_LIMIT = 50;
const DEFAULT_LOOP_MAX_ERRORS = 5;

const ARG_VALUE_FLAGS = new Set([
  "--ids",
  "--status",
  "--source",
  "--limit",
  "--endpoint",
  "--job-prefix",
  "--voice",
  "--voices",
  "--voice-mode",
  "--style",
  "--style-degree",
  "--role",
  "--rate",
  "--pitch",
  "--volume",
  "--paragraph-break-ms",
  "--sentence-break-ms",
  "--max-chars",
  "--format",
  "--max-inputs-per-job",
  "--max-payload-bytes",
  "--poll-interval-ms",
  "--timeout-ms",
  "--ttl-hours",
  "--sleep",
  "--max-passes",
  "--max-errors",
]);

const KNOWN_FLAGS = new Set([
  "--all",
  "--include-existing",
  "--include-private",
  "--dry-run",
  "--submit-only",
  "--hd",
  "--list-hd-voices",
  "--lowest-storage",
  "--concatenate",
  "--help",
  "-h",
  "--loop",
  ...ARG_VALUE_FLAGS,
]);

type Args = {
  ids: string[];
  all: boolean;
  includePrivate: boolean;
  statusRaw: string | null;
  status: ArticleStatus | null;
  source: string | null;
  limit: number | null;
  includeExisting: boolean;
  dryRun: boolean;
  submitOnly: boolean;
  endpoint: string | null;
  jobPrefix: string;
  voice: string | null;
  voices: string[];
  voiceMode: "rotate" | "random" | null;
  listHdVoices: boolean;
  hd: boolean;
  style: string | null;
  styleDegree: number | null;
  role: string | null;
  rate: string | null;
  pitch: string | null;
  volume: string | null;
  paragraphBreakMs: number;
  sentenceBreakMs: number | null;
  maxChars: number | null;
  format: string;
  concatenateResult: boolean;
  ttlHours: number;
  pollIntervalMs: number;
  timeoutMs: number;
  maxPayloadBytes: number;
  maxInputsPerJob: number;
  loop: boolean;
  sleepMs: number;
  maxPasses: number | null;
  maxErrors: number;
};

type RunOnceResult = {
  selected: number;
  submitted: number;
  persisted: number;
};

type LoopLogger = {
  log: (message: string) => void;
  error: (message: string) => void;
};

type RunLoopDeps = {
  signal: AbortSignal;
  runPass: (args: Args) => Promise<RunOnceResult>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  logger?: LoopLogger;
};

type IntegerArgOptions = {
  fallback: number | null;
  min?: number;
  clampToZero?: boolean;
};

function printHelp(): void {
  console.log(`ReadWise Azure Batch Synthesis

Submits article text to Azure Speech Batch Synthesis, requests word-boundary
timings, downloads the ZIP result, and persists ArticleSpeech rows.

Usage:
  npm run speech:batch -- <articleId> [articleId ...]
  npm run speech:batch -- --all --status PUBLISHED --limit 100
  npm run speech:batch -- --all --source "Undark" --dry-run
  npm run speech:keep -- --status PUBLISHED --limit 50
  npm run speech:batch -- --all --loop --sleep 120000 --limit 100

Selection:
  --all                    Select articles from the database.
  --ids <csv>              Article ids to synthesize.
  --status <status>        DRAFT, PUBLISHED, PROCESSING, FAILED, or ARCHIVED.
  --source <name>          Restrict to Article.source.
  --limit N                Max selected articles.
  --include-existing       Regenerate rows that already have ArticleSpeech.
  --include-private        Allow --all selection to include user/private rows.
                           Without this, --all only selects public library rows.

Azure:
  --endpoint <url>         Speech endpoint, e.g. https://<resource>.cognitiveservices.azure.com.
                           Defaults to AZURE_SPEECH_ENDPOINT, then https://<region>.api.cognitive.microsoft.com.
  --job-prefix <name>      Batch synthesis job id prefix.
  --submit-only            Submit jobs but do not wait/download/persist.
  --dry-run                Print counts/options without calling Azure.

Voice and SSML:
  --voice <name>           Single Azure voice. Defaults to AZURE_SPEECH_VOICE.
  --voices <csv>           Article voice candidate list. Defaults to article rotation unless --voice-mode random.
  --voice-mode <mode>      rotate or random by article. --hd defaults to random; --voices defaults to rotate.
  --hd                     Experimental for Batch: use built-in English DragonHD preset when --voice/--voices is omitted.
                           Test with --limit 1 first; DragonHD can be rejected by voice/region/API support.
  --list-hd-voices         Print the built-in HD preset and exit.
  --style <name>           Wrap speech in mstts:express-as style, e.g. cheerful, calm, newscast.
  --style-degree N         Style intensity 0.01..2. Requires --style.
  --role <name>            mstts:express-as role. Requires --style.
  --rate <value>           Prosody rate, e.g. -5%, medium, fast.
  --pitch <value>          Prosody pitch, e.g. -2st, +5%.
  --volume <value>         Prosody volume, e.g. soft, medium, +10%.
  --paragraph-break-ms N   Break between paragraphs/voice turns (default ${DEFAULT_BREAK_MS}).
  --sentence-break-ms N    Optional smaller break between sentences.
  --max-chars N            Optional per-article character cap. Omit for full article text.

Output:
  --format <format>        Azure output format. Default ${DEFAULT_WEB_LOW_STORAGE_FORMAT}.
  --lowest-storage         Alias for ${LOWEST_STORAGE_FORMAT}.
  --concatenate            Ask Azure to concatenate result files per job.
                           Do not use with persistence; one file cannot map back to articles.

Batch controls:
  --loop                   Keep running passes until stopped; --limit is per-pass.
                           In loop mode, omitted --limit defaults to ${DEFAULT_LOOP_LIMIT}.
  --sleep <ms>             Idle wait between loop passes (default ${DEFAULT_LOOP_SLEEP_MS}).
  --max-passes N           Stop after N loop passes. 0 or omitted means unlimited.
  --max-errors N           Abort after N consecutive failed loop passes (default ${DEFAULT_LOOP_MAX_ERRORS}).
  --max-inputs-per-job N   Default ${DEFAULT_MAX_INPUTS_PER_JOB}.
  --max-payload-bytes N    Default ${DEFAULT_MAX_PAYLOAD_BYTES}.
  --poll-interval-ms N     Default ${DEFAULT_POLL_INTERVAL_MS}.
  --timeout-ms N           Default ${DEFAULT_TIMEOUT_MS}.
  --ttl-hours N            Azure result retention after completion (default ${DEFAULT_TTL_HOURS}).
  --help                   Show this help.`);
}

function printHdVoices(): void {
  console.log("Built-in English DragonHD voice preset:");
  for (const voice of AZURE_BATCH_HD_VOICES) {
    const note = voice.note ? ` - ${voice.note}` : "";
    console.log(`- ${voice.name} (${voice.gender})${note}`);
  }
}

function parseIntegerArg(argv: string[], flag: string, options: IntegerArgOptions): number | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return options.fallback;
  const value = Number(argv[idx + 1]);
  if (!Number.isInteger(value)) return options.fallback;
  if (options.clampToZero) return Math.max(0, value);
  if (options.min !== undefined && value < options.min) return options.fallback;
  return value;
}

function parsePositiveIntArg(argv: string[], flag: string, fallback: number): number {
  return parseIntegerArg(argv, flag, { fallback, min: 1 }) ?? fallback;
}

function parseOptionalPositiveIntArg(argv: string[], flag: string): number | null {
  return parseIntegerArg(argv, flag, { fallback: null, min: 1 });
}

function parseNonNegativeIntArg(argv: string[], flag: string, fallback: number): number {
  return parseIntegerArg(argv, flag, { fallback, clampToZero: true }) ?? fallback;
}

function parseStringArg(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  const value = argv[idx + 1]?.trim();
  return value || null;
}

function parseStatus(raw: string | null): ArticleStatus | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  const values: string[] = Object.values(ArticleStatus);
  return values.includes(normalized) ? (normalized as ArticleStatus) : null;
}

function parseVoiceMode(raw: string | null): Args["voiceMode"] {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  return normalized === "rotate" || normalized === "random" ? normalized : null;
}

function parseArgs(argv: string[]): Args {
  const ids: string[] = [];
  const csvIds = parseStringArg(argv, "--ids");
  if (csvIds) addUniqueFromCsv(ids, csvIds);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("-")) {
      if (!KNOWN_FLAGS.has(arg)) warnUnknown(arg);
      if (ARG_VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    if (!ids.includes(arg)) ids.push(arg);
  }

  const styleDegreeRaw = parseStringArg(argv, "--style-degree");
  const styleDegree = styleDegreeRaw ? Number(styleDegreeRaw) : null;
  const voices: string[] = [];
  const voicesCsv = parseStringArg(argv, "--voices");
  if (voicesCsv) addUniqueFromCsv(voices, voicesCsv);

  const lowestStorage = argv.includes("--lowest-storage");
  const format = lowestStorage
    ? LOWEST_STORAGE_FORMAT
    : (parseStringArg(argv, "--format") ?? DEFAULT_WEB_LOW_STORAGE_FORMAT);
  const statusRaw = parseStringArg(argv, "--status");
  const loop = argv.includes("--loop");
  const maxPasses = parseNonNegativeIntArg(argv, "--max-passes", 0);

  return {
    ids,
    all: argv.includes("--all"),
    includePrivate: argv.includes("--include-private"),
    statusRaw,
    status: parseStatus(statusRaw),
    source: parseStringArg(argv, "--source"),
    limit: parseOptionalPositiveIntArg(argv, "--limit") ?? (loop ? DEFAULT_LOOP_LIMIT : null),
    includeExisting: argv.includes("--include-existing"),
    dryRun: argv.includes("--dry-run"),
    submitOnly: argv.includes("--submit-only"),
    endpoint: parseStringArg(argv, "--endpoint"),
    jobPrefix: parseStringArg(argv, "--job-prefix") ?? DEFAULT_AZURE_BATCH_JOB_PREFIX,
    voice: parseStringArg(argv, "--voice"),
    voices,
    voiceMode: parseVoiceMode(parseStringArg(argv, "--voice-mode")),
    listHdVoices: argv.includes("--list-hd-voices"),
    hd: argv.includes("--hd"),
    style: parseStringArg(argv, "--style"),
    styleDegree: Number.isFinite(styleDegree) ? styleDegree : null,
    role: parseStringArg(argv, "--role"),
    rate: parseStringArg(argv, "--rate"),
    pitch: parseStringArg(argv, "--pitch"),
    volume: parseStringArg(argv, "--volume"),
    paragraphBreakMs: parsePositiveIntArg(argv, "--paragraph-break-ms", DEFAULT_BREAK_MS),
    sentenceBreakMs: parseOptionalPositiveIntArg(argv, "--sentence-break-ms"),
    maxChars: parseOptionalPositiveIntArg(argv, "--max-chars"),
    format,
    concatenateResult: argv.includes("--concatenate"),
    ttlHours: parsePositiveIntArg(argv, "--ttl-hours", DEFAULT_TTL_HOURS),
    pollIntervalMs: parsePositiveIntArg(argv, "--poll-interval-ms", DEFAULT_POLL_INTERVAL_MS),
    timeoutMs: parsePositiveIntArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS),
    maxPayloadBytes: parsePositiveIntArg(argv, "--max-payload-bytes", DEFAULT_MAX_PAYLOAD_BYTES),
    maxInputsPerJob: parsePositiveIntArg(argv, "--max-inputs-per-job", DEFAULT_MAX_INPUTS_PER_JOB),
    loop,
    sleepMs: parseNonNegativeIntArg(argv, "--sleep", DEFAULT_LOOP_SLEEP_MS),
    maxPasses: maxPasses > 0 ? maxPasses : null,
    maxErrors: parsePositiveIntArg(argv, "--max-errors", DEFAULT_LOOP_MAX_ERRORS),
  };
}

function validateArgs(args: Args, argv = process.argv.slice(2)): string | null {
  if (args.listHdVoices) return null;
  if (!args.all && args.ids.length === 0) return "Pass article ids or --all.";
  if (parseStringArg(argv, "--voice-mode") && !args.voiceMode) {
    return "--voice-mode must be rotate or random.";
  }
  if (args.role && !args.style) return "--role requires --style.";
  if (args.styleDegree !== null && !args.style) return "--style-degree requires --style.";
  if (args.styleDegree !== null && (args.styleDegree < 0.01 || args.styleDegree > 2)) {
    return "--style-degree must be between 0.01 and 2.";
  }
  if (args.concatenateResult && !args.submitOnly) {
    return "--concatenate is incompatible with persistence because one audio file cannot map back to ArticleSpeech rows.";
  }
  if (args.maxPayloadBytes > AZURE_BATCH_MAX_PAYLOAD_BYTES) {
    return "--max-payload-bytes must stay within Azure's 2 MB request limit.";
  }
  if (args.maxInputsPerJob > AZURE_BATCH_MAX_INPUTS_PER_JOB) {
    return "--max-inputs-per-job must be <= 1000. The batch properties API accepts up to 1000 input objects per request body.";
  }
  if (args.status === null && args.statusRaw) {
    return "--status must be one of DRAFT, PUBLISHED, PROCESSING, FAILED, or ARCHIVED.";
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return;
  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    let finish: () => void;
    const onAbort = () => {
      finish();
    };
    finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    timeout = setTimeout(finish, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runLoop(args: Args, deps: RunLoopDeps): Promise<number> {
  const sleep = deps.sleep ?? abortableSleep;
  const logger = deps.logger ?? console;
  let pass = 0;
  let consecutiveErrors = 0;

  while (!deps.signal.aborted) {
    if (args.maxPasses !== null && pass >= args.maxPasses) break;
    pass++;

    try {
      const result = await deps.runPass(args);
      consecutiveErrors = 0;
      logger.log(
        `Loop pass ${pass} complete: selected=${result.selected} submitted=${result.submitted} persisted=${result.persisted}`,
      );
    } catch (error) {
      consecutiveErrors++;
      logger.error(
        `Loop pass ${pass} failed (${consecutiveErrors}/${args.maxErrors}): ${errorMessage(error)}`,
      );
      if (consecutiveErrors >= args.maxErrors) return 1;
    }

    if (args.maxPasses !== null && pass >= args.maxPasses) break;
    await sleep(args.sleepMs, deps.signal);
  }

  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (args.listHdVoices) {
    printHdVoices();
    return 0;
  }

  const validationError = validateArgs(args, argv);
  if (validationError) {
    console.error(validationError);
    printHelp();
    return 1;
  }

  if (!isTtsFeatureEnabled()) {
    console.error("FEATURE_TTS_ENABLED is disabled.");
    return 1;
  }

  const config = speechConfig.get();
  if (!config) {
    console.error("Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.");
    return 1;
  }

  if (!args.loop) {
    await runAzureBatchSynthesis(args, config);
    return 0;
  }

  const controller = new AbortController();
  const logger = createConsoleLogger();
  registerShutdownSignals(controller, logger);

  return runLoop(args, {
    signal: controller.signal,
    runPass: (passArgs) => runAzureBatchSynthesis(passArgs, config),
  });
}

export { parseArgs, validateArgs, runLoop, abortableSleep, main };

if (isMain(import.meta.url)) {
  runCli(main);
}
