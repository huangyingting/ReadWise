import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ArticleVisibility, type ArticleStatus, type Prisma } from "@prisma/client";
import { articleHtmlToReaderBlocks } from "@/lib/content-pipeline";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SPEECH_VOICE } from "@/lib/runtime-config/speech";
import { saveSpeechResult } from "@/lib/speech/repository";
import { enrichSpeechTimingSpans } from "@/lib/speech/timing-enrichment";
import type { SpeechWord } from "@/lib/speech/timing";
import { isObjectStorageConfigured } from "@/lib/storage";

const execFileAsync = promisify(execFile);

export const AZURE_BATCH_MAX_PAYLOAD_BYTES = 2_000_000;
export const AZURE_BATCH_MAX_INPUTS_PER_JOB = 1000;
export const DEFAULT_AZURE_BATCH_JOB_PREFIX = "readwise-batch-tts";
const AZURE_BATCH_API_VERSION = "2024-04-01";

export const AZURE_BATCH_HD_VOICES = [
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

type AzureBatchArticle = {
  id: string;
  title: string;
  source: string | null;
  status: ArticleStatus;
  content: string;
};

type AzureBatchInput = {
  article: AzureBatchArticle;
  content: string;
  plainText: string;
  voiceSummary: string;
  billableChars: number;
};

type AzureBatchJob = {
  chunkIndex: number;
  id: string;
  inputs: AzureBatchInput[];
};

type AzureBatchJobOptions = {
  format: string;
  concatenateResult: boolean;
  ttlHours: number;
  maxPayloadBytes: number;
  maxInputsPerJob: number;
  jobPrefix: string;
};

type AzureBatchPollOptions = {
  pollIntervalMs: number;
  timeoutMs: number;
};

export type AzureBatchSynthesisOptions = AzureBatchJobOptions &
  AzureBatchPollOptions & {
    ids: string[];
    all: boolean;
    includePrivate: boolean;
    status: ArticleStatus | null;
    source: string | null;
    limit: number | null;
    includeExisting: boolean;
    dryRun: boolean;
    submitOnly: boolean;
    endpoint: string | null;
    voice: string | null;
    voices: string[];
    voiceMode: "rotate" | "random" | null;
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
  };

export type AzureBatchSpeechConfig = {
  key: string;
  region: string;
  voice: string;
};

export type AzureBatchSynthesisResult = {
  selected: number;
  submitted: number;
  persisted: number;
};

type AzureBatchJobStatus = {
  id?: unknown;
  status?: unknown;
  outputs?: {
    result?: unknown;
  };
  properties?: {
    billingDetails?: unknown;
  };
};

type CreateBatchResponse = {
  id?: unknown;
  status?: unknown;
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

type ExecFileAsync = (
  file: string,
  args?: readonly string[] | null,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

type PersistJobResultsDeps = {
  tempRoot?: string;
  downloadResultZip?: typeof downloadResultZip;
  execFileAsync?: ExecFileAsync;
  listFiles?: typeof listFiles;
  parseBatchResult?: typeof parseBatchResult;
  saveSpeechResult?: typeof saveSpeechResult;
  cleanup?: typeof rm;
  logger?: Pick<typeof console, "log" | "warn">;
};

function articleWhere(
  options: AzureBatchSynthesisOptions,
): Prisma.ArticleWhereInput {
  const where: Prisma.ArticleWhereInput = {};
  if (options.ids.length > 0) where.id = { in: options.ids };
  if (options.ids.length === 0 && !options.includePrivate) {
    where.ownerId = null;
    where.visibility = ArticleVisibility.PUBLIC;
  }
  if (options.status) where.status = options.status;
  if (options.source) where.source = options.source;
  if (!options.includeExisting) where.speech = { is: null };
  return where;
}

function speechEndpoint(
  options: AzureBatchSynthesisOptions,
  region: string,
): string {
  const raw = options.endpoint ?? process.env.AZURE_SPEECH_ENDPOINT?.trim();
  const endpoint = raw && raw.length > 0
    ? raw
    : `https://${region}.api.cognitive.microsoft.com`;
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

function attr(
  name: string,
  value: string | number | null | undefined,
): string {
  return value === null || value === undefined || value === ""
    ? ""
    : ` ${name}="${xmlEscape(String(value))}"`;
}

function capParagraphs(
  paragraphs: string[],
  maxChars: number | null,
): string[] {
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

function withSentenceBreaks(
  text: string,
  breakMs: number | null,
): string {
  if (!breakMs) return xmlEscape(text);
  const pieces = text.split(/(?<=[.!?])\s+/u).filter(Boolean);
  return pieces
    .map((piece) => xmlEscape(piece))
    .join(`<break time="${breakMs}ms"/>`);
}

function wrapProsody(
  text: string,
  options: AzureBatchSynthesisOptions,
): string {
  const prosodyAttributes =
    attr("rate", options.rate) +
    attr("pitch", options.pitch) +
    attr("volume", options.volume);
  return prosodyAttributes
    ? `<prosody${prosodyAttributes}>${text}</prosody>`
    : text;
}

function wrapExpressAs(
  text: string,
  options: AzureBatchSynthesisOptions,
): string {
  if (!options.style) return text;
  const expressAttributes =
    attr("style", options.style) +
    attr("styledegree", options.styleDegree) +
    attr("role", options.role);
  return `<mstts:express-as${expressAttributes}>${text}</mstts:express-as>`;
}

function selectedVoices(
  options: AzureBatchSynthesisOptions,
  configuredVoice: string,
): string[] {
  if (options.voices.length > 0) return options.voices;
  if (options.voice) return [options.voice];
  if (options.hd) return AZURE_BATCH_HD_VOICES.map((voice) => voice.name);
  return [configuredVoice || DEFAULT_SPEECH_VOICE];
}

function effectiveVoiceMode(
  options: AzureBatchSynthesisOptions,
  voices: string[],
): "rotate" | "random" {
  if (voices.length <= 1) return "rotate";
  if (options.voiceMode) return options.voiceMode;
  return options.hd && !options.voice && options.voices.length === 0
    ? "random"
    : "rotate";
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
  article: AzureBatchArticle,
  options: AzureBatchSynthesisOptions,
  configuredVoice: string,
  articleIndex = 0,
): AzureBatchInput {
  const voices = selectedVoices(options, configuredVoice);
  const voiceMode = effectiveVoiceMode(options, voices);
  const readerText = articleHtmlToReaderBlocks(article.content);
  const paragraphs = capParagraphs(readerText.blocks, options.maxChars);
  const voice = selectArticleVoice(voices, voiceMode, articleIndex);
  const voiceBlocks = paragraphs.map((paragraph, index) => {
    const text = wrapExpressAs(
      wrapProsody(withSentenceBreaks(paragraph, options.sentenceBreakMs), options),
      options,
    );
    const breakTag = index < paragraphs.length - 1
      ? `<break time="${options.paragraphBreakMs}ms"/>`
      : "";
    return `<voice name="${xmlEscape(voice)}">${text}${breakTag}</voice>`;
  });
  const content =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
    voiceBlocks.join("") +
    `</speak>`;
  const plainText = options.maxChars ? paragraphs.join(" ") : readerText.plainText;
  return {
    article,
    content,
    plainText,
    voiceSummary: `${voiceMode}:${voice}`,
    billableChars: plainText.length,
  };
}

async function selectArticles(
  options: AzureBatchSynthesisOptions,
): Promise<AzureBatchArticle[]> {
  return prisma.article.findMany({
    where: articleWhere(options),
    orderBy: { createdAt: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
    select: {
      id: true,
      title: true,
      source: true,
      status: true,
      content: true,
    },
  });
}

function mimeTypeForFormat(format: string): string {
  const lower = format.toLowerCase();
  if (lower.includes("mp3")) return "audio/mpeg";
  if (lower.includes("ogg") || lower.includes("opus")) return "audio/ogg";
  if (lower.includes("webm")) return "audio/webm";
  if (lower.includes("riff") || lower.includes("wav")) return "audio/wav";
  return "application/octet-stream";
}

function batchRequestBody(
  options: AzureBatchJobOptions,
  inputs: AzureBatchInput[],
): unknown {
  return {
    description: `ReadWise batch TTS (${inputs.length} article${inputs.length === 1 ? "" : "s"})`,
    inputKind: "SSML",
    inputs: inputs.map((input) => ({ content: input.content })),
    properties: {
      outputFormat: options.format,
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
      concatenateResult: options.concatenateResult,
      decompressOutputFiles: false,
      timeToLiveInHours: options.ttlHours,
    },
  };
}

function bodySizeBytes(
  options: AzureBatchJobOptions,
  inputs: AzureBatchInput[],
): number {
  return Buffer.byteLength(JSON.stringify(batchRequestBody(options, inputs)), "utf8");
}

function buildJobs(
  options: AzureBatchJobOptions,
  inputs: AzureBatchInput[],
): AzureBatchJob[] {
  const jobs: AzureBatchJob[] = [];
  let chunk: AzureBatchInput[] = [];
  let chunkIndex = 1;
  for (const input of inputs) {
    const candidate = [...chunk, input];
    if (
      chunk.length > 0 &&
      (candidate.length > options.maxInputsPerJob ||
        bodySizeBytes(options, candidate) > options.maxPayloadBytes)
    ) {
      jobs.push({
        chunkIndex,
        id: jobId(options.jobPrefix, chunkIndex),
        inputs: chunk,
      });
      chunkIndex++;
      chunk = [input];
    } else {
      chunk = candidate;
    }
  }

  if (chunk.length > 0) {
    if (bodySizeBytes(options, chunk) > options.maxPayloadBytes) {
      throw new Error(
        `Article ${chunk[0]?.article.id ?? "(unknown)"} exceeds the configured payload limit; use --max-chars or a larger --max-payload-bytes within Azure's 2 MB limit.`,
      );
    }
    jobs.push({
      chunkIndex,
      id: jobId(options.jobPrefix, chunkIndex),
      inputs: chunk,
    });
  }
  return jobs;
}

function jobId(prefix: string, chunkIndex: number): string {
  const safePrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = `${Date.now().toString(36)}-${chunkIndex}-${randomUUID().slice(0, 8)}`;
  return `${safePrefix || DEFAULT_AZURE_BATCH_JOB_PREFIX}-${suffix}`
    .slice(0, 64)
    .replace(/[-_.]+$/g, "x");
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

async function createBatchJob(
  endpoint: string,
  key: string,
  options: AzureBatchJobOptions,
  job: AzureBatchJob,
): Promise<void> {
  const url = `${endpoint}/texttospeech/batchsyntheses/${encodeURIComponent(job.id)}?api-version=${AZURE_BATCH_API_VERSION}`;
  const response = (await requestJson(url, {
    method: "PUT",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batchRequestBody(options, job.inputs)),
  })) as CreateBatchResponse;
  const status = typeof response?.status === "string" ? response.status : "unknown";
  console.log(`submitted ${job.id} (${job.inputs.length} article(s), status=${status})`);
}

async function getBatchJob(
  endpoint: string,
  key: string,
  id: string,
): Promise<AzureBatchJobStatus> {
  const url = `${endpoint}/texttospeech/batchsyntheses/${encodeURIComponent(id)}?api-version=${AZURE_BATCH_API_VERSION}`;
  return (await requestJson(url, {
    method: "GET",
    headers: { "Ocp-Apim-Subscription-Key": key },
  })) as AzureBatchJobStatus;
}

async function waitForBatchJob(
  endpoint: string,
  key: string,
  options: AzureBatchPollOptions,
  id: string,
): Promise<AzureBatchJobStatus> {
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    const job = await getBatchJob(endpoint, key, id);
    const status = typeof job.status === "string" ? job.status : "Unknown";
    console.log(`poll ${id}: ${status}`);
    if (status === "Succeeded") return job;
    if (status === "Failed") throw new Error(`Azure batch synthesis job failed: ${id}`);
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }
  throw new Error(`Timed out waiting for Azure batch synthesis job: ${id}`);
}

async function downloadResultZip(
  url: string,
  key: string,
  targetPath: string,
): Promise<void> {
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
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function prefixForIndex(index: number): string {
  return String(index + 1).padStart(4, "0");
}

function findBatchFile(
  files: string[],
  index: number,
  kind: "audio" | "word",
): string | null {
  const prefix = prefixForIndex(index);
  const candidates = files.filter((file) => path.basename(file).startsWith(prefix));
  if (kind === "word") {
    return candidates.find((file) => path.basename(file).endsWith(".word.json")) ?? null;
  }
  return (
    candidates.find((file) => {
      const basename = path.basename(file);
      return !basename.endsWith(".json") && !basename.includes(".debug.");
    }) ?? null
  );
}

function isNonNegativeBatchOffset(value: unknown): value is number {
  return typeof value === "number" && !(value < 0);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function batchWordFromBoundary(item: BatchWordBoundary): SpeechWord | null {
  if (
    typeof item.Text !== "string" ||
    !isNonNegativeBatchOffset(item.AudioOffset) ||
    !isNonNegativeBatchOffset(item.Duration)
  ) {
    return null;
  }

  const word: SpeechWord = {
    word: item.Text,
    startMs: item.AudioOffset,
    endMs: item.AudioOffset + item.Duration,
  };
  const textOffset = item.TextOffset;
  const textLength = item.WordLength ?? item.TextLength;
  if (
    isFiniteNonNegativeNumber(textOffset) &&
    isFiniteNonNegativeNumber(textLength) &&
    textLength > 0
  ) {
    word.textStart = textOffset;
    word.textEnd = textOffset + textLength;
  }
  return word;
}

function parseBatchWords(raw: unknown): SpeechWord[] {
  if (!Array.isArray(raw)) return [];
  const words: SpeechWord[] = [];
  for (const item of raw as BatchWordBoundary[]) {
    const word = batchWordFromBoundary(item);
    if (word) words.push(word);
  }
  return words.sort((left, right) => left.startMs - right.startMs);
}

async function parseBatchResult(
  files: string[],
  index: number,
): Promise<ParsedBatchResult> {
  const audioPath = findBatchFile(files, index, "audio");
  if (!audioPath) {
    throw new Error(`Batch result missing audio file for input ${prefixForIndex(index)}`);
  }
  const wordPath = findBatchFile(files, index, "word");
  const words = wordPath
    ? parseBatchWords(JSON.parse(await readFile(wordPath, "utf8")))
    : [];
  return { audio: await readFile(audioPath), words };
}

async function persistJobResults(
  job: AzureBatchJob,
  resultUrl: string,
  key: string,
  options: AzureBatchJobOptions,
  deps: PersistJobResultsDeps = {},
): Promise<number> {
  const tempDirectory = await mkdtemp(
    path.join(deps.tempRoot ?? tmpdir(), "readwise-batch-tts-"),
  );
  const download = deps.downloadResultZip ?? downloadResultZip;
  const unzip = deps.execFileAsync ?? execFileAsync;
  const readFiles = deps.listFiles ?? listFiles;
  const parseResult = deps.parseBatchResult ?? parseBatchResult;
  const saveResult = deps.saveSpeechResult ?? saveSpeechResult;
  const cleanup = deps.cleanup ?? rm;
  const logger = deps.logger ?? console;
  try {
    const zipPath = path.join(tempDirectory, "results.zip");
    const outputDirectory = path.join(tempDirectory, "out");
    await download(resultUrl, key, zipPath);
    await unzip("unzip", ["-q", zipPath, "-d", outputDirectory]);
    const files = await readFiles(outputDirectory);
    const mimeType = mimeTypeForFormat(options.format);
    let saved = 0;
    for (let index = 0; index < job.inputs.length; index++) {
      const input = job.inputs[index]!;
      const parsed = await parseResult(files, index);
      const words = enrichSpeechTimingSpans(parsed.words, input.plainText);
      const savedResult = await saveResult({
        articleId: input.article.id,
        audio: parsed.audio,
        mimeType,
        voice: input.voiceSummary,
        provider: "azure-batch",
        words,
      });
      if (!savedResult) {
        logger.warn(
          `skipped ArticleSpeech article=${input.article.id} reason=media-storage-unavailable`,
        );
        continue;
      }
      logger.log(
        `saved ArticleSpeech article=${input.article.id} words=${words.length} bytes=${parsed.audio.length}`,
      );
      saved++;
    }
    return saved;
  } finally {
    await cleanup(tempDirectory, { recursive: true, force: true });
  }
}

export async function runAzureBatchSynthesis(
  options: AzureBatchSynthesisOptions,
  config: AzureBatchSpeechConfig,
): Promise<AzureBatchSynthesisResult> {
  const articles = await selectArticles(options);
  if (articles.length === 0) {
    console.log("No articles selected.");
    return { selected: 0, submitted: 0, persisted: 0 };
  }

  const inputs = articles
    .map((article, index) => buildSsml(article, options, config.voice, index))
    .filter((input) => input.plainText.trim().length > 0);
  const skippedEmpty = articles.length - inputs.length;
  if (skippedEmpty > 0) {
    console.log(`Skipped ${skippedEmpty} article(s) with empty reader text.`);
  }
  if (inputs.length === 0) {
    console.log("No articles with synthesizable reader text selected.");
    return { selected: articles.length, submitted: 0, persisted: 0 };
  }

  const jobs = buildJobs(options, inputs);
  const totalChars = inputs.reduce((sum, input) => sum + input.billableChars, 0);
  const totalPayloadBytes = jobs.reduce(
    (sum, job) => sum + bodySizeBytes(options, job.inputs),
    0,
  );
  const endpoint = speechEndpoint(options, config.region);

  console.log(
    `Selected ${articles.length} article(s), ${totalChars.toLocaleString()} plain-text chars, ${jobs.length} batch job(s).`,
  );
  console.log(
    `format=${options.format} endpoint=${endpoint} output=ArticleSpeech wordBoundary=true`,
  );
  console.log(`estimated request payload bytes=${totalPayloadBytes.toLocaleString()}`);

  if (options.dryRun) {
    return { selected: articles.length, submitted: jobs.length, persisted: 0 };
  }

  if (!options.submitOnly && !isObjectStorageConfigured()) {
    console.warn(
      "Media storage is unavailable; batch audio will not be persisted until local or Azure storage is configured.",
    );
  }

  let persisted = 0;
  for (const job of jobs) {
    await createBatchJob(endpoint, config.key, options, job);
    if (options.submitOnly) continue;

    const completed = await waitForBatchJob(endpoint, config.key, options, job.id);
    const resultUrl = completed.outputs?.result;
    if (typeof resultUrl !== "string" || !resultUrl) {
      throw new Error(`Azure batch synthesis job ${job.id} succeeded without outputs.result`);
    }
    persisted += await persistJobResults(job, resultUrl, config.key, options);
  }

  console.log(`Done. submitted=${jobs.length} persisted=${persisted}`);
  return { selected: articles.length, submitted: jobs.length, persisted };
}