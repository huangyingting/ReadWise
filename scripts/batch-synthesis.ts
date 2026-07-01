import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ArticleStatus, ArticleVisibility, type Prisma } from "@prisma/client";

import { articleHtmlToReaderBlocks } from "@/lib/content-pipeline";
import { isTtsFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { DEFAULT_SPEECH_VOICE, speechConfig } from "@/lib/runtime-config/speech";
import { prisma } from "@/lib/prisma";
import { saveSpeechResult } from "@/lib/speech/repository";
import { extractSpeechBoundaryTokens, type SpeechWord } from "@/lib/speech/timing";
import { buildTokenAlignment } from "@/lib/speech/timing-alignment";
import { isObjectStorageConfigured } from "@/lib/storage";

import { addUniqueFromCsv, isMain, runCli, warnUnknown } from "./lib/cli";

const execFileAsync = promisify(execFile);

const API_VERSION = "2024-04-01";
const DEFAULT_JOB_PREFIX = "readwise-batch-tts";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 168;
const DEFAULT_BREAK_MS = 450;
const AZURE_MAX_PAYLOAD_BYTES = 2_000_000;
const AZURE_MAX_INPUTS_PER_JOB = 1000;
const DEFAULT_MAX_PAYLOAD_BYTES = AZURE_MAX_PAYLOAD_BYTES;
const DEFAULT_MAX_INPUTS_PER_JOB = AZURE_MAX_INPUTS_PER_JOB;
const LOWEST_STORAGE_FORMAT = "audio-16khz-32kbitrate-mono-mp3";
const DEFAULT_WEB_LOW_STORAGE_FORMAT = LOWEST_STORAGE_FORMAT;

const ENGLISH_DRAGON_HD_VOICES = [
  { name: "en-US-Adam:DragonHDLatestNeural", gender: "Male", note: "" },
  { name: "en-US-Alloy:DragonHDLatestNeural", gender: "Male", note: "" },
  { name: "en-US-Andrew:DragonHDLatestNeural", gender: "Male", note: "" },
  { name: "en-US-Andrew2:DragonHDLatestNeural", gender: "Male", note: "Optimized for conversational content" },
  { name: "en-US-Aria:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Ava:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Brian:DragonHDLatestNeural", gender: "Male", note: "" },
  { name: "en-US-Davis:DragonHDLatestNeural", gender: "Male", note: "" },
  { name: "en-US-Emma:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Emma2:DragonHDLatestNeural", gender: "Female", note: "Optimized for conversational content" },
  { name: "en-US-Jenny:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Nova:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Phoebe:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Serena:DragonHDLatestNeural", gender: "Female", note: "" },
  { name: "en-US-Steffan:DragonHDLatestNeural", gender: "Male", note: "" },
] as const;

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
};

type ArticleRow = {
  id: string;
  title: string;
  source: string | null;
  status: ArticleStatus;
  content: string;
};

type BatchInput = {
  article: ArticleRow;
  content: string;
  plainText: string;
  voiceSummary: string;
  billableChars: number;
};

type BatchJob = {
  chunkIndex: number;
  id: string;
  inputs: BatchInput[];
};

type CreateBatchResponse = {
  id?: unknown;
  status?: unknown;
};

type GetBatchResponse = {
  id?: unknown;
  status?: unknown;
  outputs?: {
    result?: unknown;
  };
  properties?: {
    billingDetails?: unknown;
  };
};

type BatchWordBoundary = {
  Text?: unknown;
  AudioOffset?: unknown;
  Duration?: unknown;
  TextOffset?: unknown;
  WordLength?: unknown;
  TextLength?: unknown;
};

type ParsedBatchResult = {
  audio: Buffer;
  words: SpeechWord[];
};

function printHelp(): void {
  console.log(`ReadWise Azure Batch Synthesis

Submits article text to Azure Speech Batch Synthesis, requests word-boundary
timings, downloads the ZIP result, and persists ArticleSpeech rows.

Usage:
  npm run speech:batch -- <articleId> [articleId ...]
  npm run speech:batch -- --all --status PUBLISHED --limit 100
  npm run speech:batch -- --all --source "Undark" --dry-run

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
  --max-inputs-per-job N   Default ${DEFAULT_MAX_INPUTS_PER_JOB}.
  --max-payload-bytes N    Default ${DEFAULT_MAX_PAYLOAD_BYTES}.
  --poll-interval-ms N     Default ${DEFAULT_POLL_INTERVAL_MS}.
  --timeout-ms N           Default ${DEFAULT_TIMEOUT_MS}.
  --ttl-hours N            Azure result retention after completion (default ${DEFAULT_TTL_HOURS}).
  --help                   Show this help.`);
}

function printHdVoices(): void {
  console.log("Built-in English DragonHD voice preset:");
  for (const voice of ENGLISH_DRAGON_HD_VOICES) {
    const note = voice.note ? ` - ${voice.note}` : "";
    console.log(`- ${voice.name} (${voice.gender})${note}`);
  }
}

function parsePositiveIntArg(argv: string[], flag: string, fallback: number): number {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return fallback;
  const value = Number(argv[idx + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseOptionalPositiveIntArg(argv: string[], flag: string): number | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  const value = Number(argv[idx + 1]);
  return Number.isInteger(value) && value > 0 ? value : null;
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
      const takesValue = new Set([
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
      ]);
      const knownFlags = new Set([
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
        ...takesValue,
      ]);
      if (!knownFlags.has(arg)) warnUnknown(arg);
      if (takesValue.has(arg)) i++;
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

  return {
    ids,
    all: argv.includes("--all"),
    includePrivate: argv.includes("--include-private"),
    statusRaw,
    status: parseStatus(statusRaw),
    source: parseStringArg(argv, "--source"),
    limit: parseOptionalPositiveIntArg(argv, "--limit"),
    includeExisting: argv.includes("--include-existing"),
    dryRun: argv.includes("--dry-run"),
    submitOnly: argv.includes("--submit-only"),
    endpoint: parseStringArg(argv, "--endpoint"),
    jobPrefix: parseStringArg(argv, "--job-prefix") ?? DEFAULT_JOB_PREFIX,
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
  };
}

function validateArgs(args: Args): string | null {
  if (args.listHdVoices) return null;
  if (!args.all && args.ids.length === 0) return "Pass article ids or --all.";
  if (parseStringArg(process.argv.slice(2), "--voice-mode") && !args.voiceMode) {
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
  if (args.maxPayloadBytes > AZURE_MAX_PAYLOAD_BYTES) {
    return "--max-payload-bytes must stay within Azure's 2 MB request limit.";
  }
  if (args.maxInputsPerJob > AZURE_MAX_INPUTS_PER_JOB) {
    return "--max-inputs-per-job must be <= 1000. The batch properties API accepts up to 1000 input objects per request body.";
  }
  if (args.status === null && args.statusRaw) {
    return "--status must be one of DRAFT, PUBLISHED, PROCESSING, FAILED, or ARCHIVED.";
  }
  return null;
}

function speechEndpoint(args: Args, region: string): string {
  const raw = args.endpoint ?? process.env.AZURE_SPEECH_ENDPOINT?.trim();
  const endpoint = raw && raw.length > 0 ? raw : `https://${region}.api.cognitive.microsoft.com`;
  return endpoint.replace(/\/+$/, "");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attr(name: string, value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "" : ` ${name}="${xmlEscape(String(value))}"`;
}

function capParagraphs(paragraphs: string[], maxChars: number | null): string[] {
  if (!maxChars) return paragraphs;
  const capped: string[] = [];
  let remaining = maxChars;
  for (const paragraph of paragraphs) {
    if (remaining <= 0) break;
    if (paragraph.length <= remaining) {
      capped.push(paragraph);
      remaining -= paragraph.length;
      continue;
    }
    capped.push(paragraph.slice(0, remaining).trim());
    break;
  }
  return capped.filter(Boolean);
}

function withSentenceBreaks(text: string, breakMs: number | null): string {
  if (!breakMs) return xmlEscape(text);
  const pieces = text.split(/(?<=[.!?])\s+/u).filter(Boolean);
  return pieces.map((piece) => xmlEscape(piece)).join(`<break time="${breakMs}ms"/>`);
}

function wrapProsody(text: string, args: Args): string {
  const prosodyAttrs =
    attr("rate", args.rate) + attr("pitch", args.pitch) + attr("volume", args.volume);
  return prosodyAttrs ? `<prosody${prosodyAttrs}>${text}</prosody>` : text;
}

function wrapExpressAs(text: string, args: Args): string {
  if (!args.style) return text;
  const expressAttrs =
    attr("style", args.style) + attr("styledegree", args.styleDegree) + attr("role", args.role);
  return `<mstts:express-as${expressAttrs}>${text}</mstts:express-as>`;
}

function selectedVoices(args: Args, configuredVoice: string): string[] {
  if (args.voices.length > 0) return args.voices;
  if (args.voice) return [args.voice];
  if (args.hd) return ENGLISH_DRAGON_HD_VOICES.map((voice) => voice.name);
  return [configuredVoice || DEFAULT_SPEECH_VOICE];
}

function effectiveVoiceMode(args: Args, voices: string[]): "rotate" | "random" {
  if (voices.length <= 1) return "rotate";
  if (args.voiceMode) return args.voiceMode;
  return args.hd && !args.voice && args.voices.length === 0 ? "random" : "rotate";
}

function randomVoice(voices: string[], previous: string | null): string {
  if (voices.length === 1) return voices[0]!;
  const selected = voices[randomInt(voices.length)]!;
  if (selected !== previous) return selected;
  const selectedIndex = voices.indexOf(selected);
  return voices[(selectedIndex + 1) % voices.length]!;
}

function selectArticleVoice(
  voices: string[],
  voiceMode: "rotate" | "random",
  articleIndex: number,
): string {
  if (voiceMode === "random") return randomVoice(voices, null);
  return voices[articleIndex % voices.length]!;
}

function buildSsml(
  article: ArticleRow,
  args: Args,
  configuredVoice: string,
  articleIndex = 0,
): BatchInput {
  const voices = selectedVoices(args, configuredVoice);
  const voiceMode = effectiveVoiceMode(args, voices);
  const readerText = articleHtmlToReaderBlocks(article.content);
  const paragraphs = capParagraphs(readerText.blocks, args.maxChars);
  const voice = selectArticleVoice(voices, voiceMode, articleIndex);
  const voiceBlocks = paragraphs.map((paragraph, index) => {
    const text = wrapExpressAs(
      wrapProsody(withSentenceBreaks(paragraph, args.sentenceBreakMs), args),
      args,
    );
    const breakTag = index < paragraphs.length - 1 ? `<break time="${args.paragraphBreakMs}ms"/>` : "";
    return `<voice name="${xmlEscape(voice)}">${text}${breakTag}</voice>`;
  });
  const content =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
    voiceBlocks.join("") +
    `</speak>`;
  const plainText = args.maxChars ? paragraphs.join(" ") : readerText.plainText;
  return {
    article,
    content,
    plainText,
    voiceSummary: `${voiceMode}:${voice}`,
    billableChars: plainText.length,
  };
}

function mimeTypeForFormat(format: string): string {
  const lower = format.toLowerCase();
  if (lower.includes("mp3")) return "audio/mpeg";
  if (lower.includes("ogg") || lower.includes("opus")) return "audio/ogg";
  if (lower.includes("webm")) return "audio/webm";
  if (lower.includes("riff") || lower.includes("wav")) return "audio/wav";
  return "application/octet-stream";
}

function batchRequestBody(args: Args, inputs: BatchInput[]): unknown {
  return {
    description: `ReadWise batch TTS (${inputs.length} article${inputs.length === 1 ? "" : "s"})`,
    inputKind: "SSML",
    inputs: inputs.map((input) => ({ content: input.content })),
    properties: {
      outputFormat: args.format,
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
      concatenateResult: args.concatenateResult,
      decompressOutputFiles: false,
      timeToLiveInHours: args.ttlHours,
    },
  };
}

function bodySizeBytes(args: Args, inputs: BatchInput[]): number {
  return Buffer.byteLength(JSON.stringify(batchRequestBody(args, inputs)), "utf8");
}

function buildJobs(args: Args, inputs: BatchInput[]): BatchJob[] {
  const jobs: BatchJob[] = [];
  let chunk: BatchInput[] = [];
  let chunkIndex = 1;
  for (const input of inputs) {
    const candidate = [...chunk, input];
    if (
      chunk.length > 0 &&
      (candidate.length > args.maxInputsPerJob || bodySizeBytes(args, candidate) > args.maxPayloadBytes)
    ) {
      jobs.push({ chunkIndex, id: jobId(args.jobPrefix, chunkIndex), inputs: chunk });
      chunkIndex++;
      chunk = [input];
    } else {
      chunk = candidate;
    }
  }
  if (chunk.length > 0) {
    if (bodySizeBytes(args, chunk) > args.maxPayloadBytes) {
      throw new Error(
        `Article ${chunk[0]?.article.id ?? "(unknown)"} exceeds the configured payload limit; use --max-chars or a larger --max-payload-bytes within Azure's 2 MB limit.`,
      );
    }
    jobs.push({ chunkIndex, id: jobId(args.jobPrefix, chunkIndex), inputs: chunk });
  }
  return jobs;
}

function jobId(prefix: string, chunkIndex: number): string {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = `${Date.now().toString(36)}-${chunkIndex}-${randomUUID().slice(0, 8)}`;
  return `${safePrefix || DEFAULT_JOB_PREFIX}-${suffix}`.slice(0, 64).replace(/[-_.]+$/g, "x");
}

async function selectArticles(args: Args): Promise<ArticleRow[]> {
  const where: Prisma.ArticleWhereInput = {};
  if (args.ids.length > 0) where.id = { in: args.ids };
  if (args.ids.length === 0 && !args.includePrivate) {
    where.ownerId = null;
    where.visibility = ArticleVisibility.PUBLIC;
  }
  if (args.status) where.status = args.status;
  if (args.source) where.source = args.source;
  if (!args.includeExisting) {
    where.speech = { is: null };
  }
  const rows = await prisma.article.findMany({
    where,
    orderBy: { createdAt: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
    select: {
      id: true,
      title: true,
      source: true,
      status: true,
      content: true,
    },
  });
  return rows;
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Azure Batch Synthesis HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return body ? JSON.parse(body) : null;
}

async function createBatchJob(endpoint: string, key: string, args: Args, job: BatchJob): Promise<void> {
  const url = `${endpoint}/texttospeech/batchsyntheses/${encodeURIComponent(job.id)}?api-version=${API_VERSION}`;
  const response = (await requestJson(url, {
    method: "PUT",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batchRequestBody(args, job.inputs)),
  })) as CreateBatchResponse;
  const status = typeof response?.status === "string" ? response.status : "unknown";
  console.log(`submitted ${job.id} (${job.inputs.length} article(s), status=${status})`);
}

async function getBatchJob(endpoint: string, key: string, id: string): Promise<GetBatchResponse> {
  const url = `${endpoint}/texttospeech/batchsyntheses/${encodeURIComponent(id)}?api-version=${API_VERSION}`;
  return (await requestJson(url, {
    method: "GET",
    headers: { "Ocp-Apim-Subscription-Key": key },
  })) as GetBatchResponse;
}

async function waitForBatchJob(endpoint: string, key: string, args: Args, id: string): Promise<GetBatchResponse> {
  const started = Date.now();
  while (Date.now() - started < args.timeoutMs) {
    const job = await getBatchJob(endpoint, key, id);
    const status = typeof job.status === "string" ? job.status : "Unknown";
    console.log(`poll ${id}: ${status}`);
    if (status === "Succeeded") return job;
    if (status === "Failed") throw new Error(`Azure batch synthesis job failed: ${id}`);
    await new Promise((resolve) => setTimeout(resolve, args.pollIntervalMs));
  }
  throw new Error(`Timed out waiting for Azure batch synthesis job: ${id}`);
}

async function downloadResultZip(url: string, key: string, targetPath: string): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Ocp-Apim-Subscription-Key": key },
  });
  if (!response.ok) {
    throw new Error(`Could not download Azure batch result ZIP: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, bytes);
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

function prefixForIndex(index: number): string {
  return String(index + 1).padStart(4, "0");
}

function findBatchFile(files: string[], index: number, kind: "audio" | "word"): string | null {
  const prefix = prefixForIndex(index);
  const candidates = files.filter((file) => path.basename(file).startsWith(prefix));
  if (kind === "word") {
    return candidates.find((file) => path.basename(file).endsWith(".word.json")) ?? null;
  }
  return (
    candidates.find((file) => {
      const base = path.basename(file);
      return !base.endsWith(".json") && !base.includes(".debug.");
    }) ?? null
  );
}

function parseBatchWords(raw: unknown): SpeechWord[] {
  if (!Array.isArray(raw)) return [];
  const words: SpeechWord[] = [];
  for (const item of raw as BatchWordBoundary[]) {
    if (
      typeof item.Text !== "string" ||
      typeof item.AudioOffset !== "number" ||
      typeof item.Duration !== "number" ||
      item.AudioOffset < 0 ||
      item.Duration < 0
    ) {
      continue;
    }
    const word: SpeechWord = {
      word: item.Text,
      startMs: item.AudioOffset,
      endMs: item.AudioOffset + item.Duration,
    };
    const textOffset = item.TextOffset;
    const textLength = item.WordLength ?? item.TextLength;
    if (
      typeof textOffset === "number" &&
      typeof textLength === "number" &&
      Number.isFinite(textOffset) &&
      Number.isFinite(textLength) &&
      textOffset >= 0 &&
      textLength > 0
    ) {
      word.textStart = textOffset;
      word.textEnd = textOffset + textLength;
    }
    words.push(word);
  }
  return words.sort((a, b) => a.startMs - b.startMs);
}

function hasTextSpan(word: SpeechWord): boolean {
  return (
    typeof word.textStart === "number" &&
    Number.isFinite(word.textStart) &&
    typeof word.textEnd === "number" &&
    Number.isFinite(word.textEnd) &&
    word.textStart >= 0 &&
    word.textEnd > word.textStart
  );
}

function enrichBatchWordsWithTextSpans(words: SpeechWord[], plainText: string): SpeechWord[] {
  if (words.length === 0 || !plainText) return words;
  if (words.every(hasTextSpan)) return words;

  const tokens = extractSpeechBoundaryTokens(plainText);
  const { alignment, spanLengths } = buildTokenAlignment(tokens, words);
  return words.map((word, index) => {
    if (hasTextSpan(word)) return word;
    const tokenIndex = alignment[index];
    if (tokenIndex == null) return word;

    const spanLength = Math.max(1, spanLengths[index] ?? 1);
    const firstToken = tokens[tokenIndex];
    const lastToken = tokens[tokenIndex + spanLength - 1] ?? firstToken;
    if (!firstToken || !lastToken) return word;

    return {
      ...word,
      textStart: firstToken.start,
      textEnd: lastToken.end,
    };
  });
}

async function parseBatchResult(files: string[], index: number): Promise<ParsedBatchResult> {
  const audioPath = findBatchFile(files, index, "audio");
  if (!audioPath) throw new Error(`Batch result missing audio file for input ${prefixForIndex(index)}`);
  const wordPath = findBatchFile(files, index, "word");
  const words = wordPath ? parseBatchWords(JSON.parse(await readFile(wordPath, "utf8"))) : [];
  return { audio: await readFile(audioPath), words };
}

async function persistJobResults(job: BatchJob, resultUrl: string, key: string, args: Args): Promise<number> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "readwise-batch-tts-"));
  try {
    const zipPath = path.join(tempDir, "results.zip");
    const outDir = path.join(tempDir, "out");
    await downloadResultZip(resultUrl, key, zipPath);
    await execFileAsync("unzip", ["-q", zipPath, "-d", outDir]);
    const files = await listFiles(outDir);
    const mimeType = mimeTypeForFormat(args.format);
    let saved = 0;
    for (let i = 0; i < job.inputs.length; i++) {
      const input = job.inputs[i]!;
      const parsed = await parseBatchResult(files, i);
      const words = enrichBatchWordsWithTextSpans(parsed.words, input.plainText);
      await saveSpeechResult({
        articleId: input.article.id,
        audio: parsed.audio,
        mimeType,
        voice: input.voiceSummary,
        format: args.format,
        plainText: input.plainText,
        provider: "azure-batch",
        words,
      });
      console.log(
        `saved ArticleSpeech article=${input.article.id} words=${words.length} bytes=${parsed.audio.length}`,
      );
      saved++;
    }
    return saved;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (args.listHdVoices) {
    printHdVoices();
    return 0;
  }

  const validationError = validateArgs(args);
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

  const articles = await selectArticles(args);
  if (articles.length === 0) {
    console.log("No articles selected.");
    return 0;
  }

  const inputs = articles
    .map((article, index) => buildSsml(article, args, config.voice, index))
    .filter((input) => input.plainText.trim().length > 0);
  const skippedEmpty = articles.length - inputs.length;
  if (skippedEmpty > 0) {
    console.log(`Skipped ${skippedEmpty} article(s) with empty reader text.`);
  }
  if (inputs.length === 0) {
    console.log("No articles with synthesizable reader text selected.");
    return 0;
  }
  const jobs = buildJobs(args, inputs);
  const totalChars = inputs.reduce((sum, input) => sum + input.billableChars, 0);
  const totalPayloadBytes = jobs.reduce((sum, job) => sum + bodySizeBytes(args, job.inputs), 0);
  const endpoint = speechEndpoint(args, config.region);

  console.log(
    `Selected ${articles.length} article(s), ${totalChars.toLocaleString()} plain-text chars, ${jobs.length} batch job(s).`,
  );
  console.log(`format=${args.format} endpoint=${endpoint} output=ArticleSpeech wordBoundary=true`);
  console.log(`estimated request payload bytes=${totalPayloadBytes.toLocaleString()}`);

  if (args.dryRun) return 0;

  if (!args.submitOnly && !isObjectStorageConfigured()) {
    console.warn(
      "Media object storage is not configured; persisted batch audio will use ArticleSpeech.audioBase64.",
    );
  }

  let persisted = 0;
  for (const job of jobs) {
    await createBatchJob(endpoint, config.key, args, job);
    if (args.submitOnly) continue;
    const completed = await waitForBatchJob(endpoint, config.key, args, job.id);
    const resultUrl = completed.outputs?.result;
    if (typeof resultUrl !== "string" || !resultUrl) {
      throw new Error(`Azure batch synthesis job ${job.id} succeeded without outputs.result`);
    }
    persisted += await persistJobResults(job, resultUrl, config.key, args);
  }

  console.log(`Done. submitted=${jobs.length} persisted=${persisted}`);
  return 0;
}

export { parseArgs, buildSsml, mimeTypeForFormat };

if (isMain(import.meta.url)) {
  runCli(main);
}
