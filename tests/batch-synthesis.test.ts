process.env.LOG_LEVEL = "error";

import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleStatus } from "@prisma/client";
import type { SpeechConfig } from "@/lib/runtime-config/speech";

const TEST_ARTIFACT_ROOT = path.join(process.cwd(), ".test-artifacts", "batch-synthesis");

let articleRows: unknown[] = [];
let lastFindManyArgs: unknown = null;
let storageConfigured = false;
let ttsEnabled = true;
let speechRuntimeConfig: SpeechConfig | null = {
  key: "speech-key",
  region: "eastus",
  voice: "en-US-TestNeural",
  format: "audio-16khz-32kbitrate-mono-mp3",
};
const savedSpeechInputs: unknown[] = [];
let saveSpeechResultImpl = async (input: unknown) => {
  savedSpeechInputs.push(input);
  return true;
};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: unknown) => {
            lastFindManyArgs = args;
            return articleRows;
          },
        },
        $disconnect: async () => {},
      },
    },
  });
  mock.module("@/lib/storage", {
    namedExports: {
      getMediaStorage: () => null,
      isObjectStorageConfigured: () => storageConfigured,
    },
  });
  mock.module("@/lib/worker", {
    namedExports: {
      createConsoleLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    },
  });
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isTtsFeatureEnabled: () => ttsEnabled,
    },
  });
  mock.module("@/lib/runtime-config/speech", {
    namedExports: {
      DEFAULT_SPEECH_VOICE: "en-US-DefaultNeural",
      speechConfig: {
        get: () => speechRuntimeConfig,
      },
    },
  });
  mock.module("@/lib/speech/repository", {
    namedExports: {
      saveSpeechResult: (input: unknown) => saveSpeechResultImpl(input),
    },
  });
});

beforeEach(async () => {
  articleRows = [];
  lastFindManyArgs = null;
  storageConfigured = false;
  ttsEnabled = true;
  speechRuntimeConfig = {
    key: "speech-key",
    region: "eastus",
    voice: "en-US-TestNeural",
    format: "audio-16khz-32kbitrate-mono-mp3",
  };
  savedSpeechInputs.length = 0;
  saveSpeechResultImpl = async (input: unknown) => {
    savedSpeechInputs.push(input);
    return true;
  };
  await rm(TEST_ARTIFACT_ROOT, { recursive: true, force: true });
  await mkdir(TEST_ARTIFACT_ROOT, { recursive: true });
});

after(async () => {
  await rm(TEST_ARTIFACT_ROOT, { recursive: true, force: true });
});

async function loadBatchSynthesis() {
  return import("../scripts/batch-synthesis");
}

function silentLogger() {
  return {
    log: () => {},
    error: () => {},
  };
}

function successfulPassResult() {
  return { selected: 1, submitted: 1, persisted: 1 };
}

type ArticleFixture = {
  id: string;
  title: string;
  source: string | null;
  status: ArticleStatus;
  content: string;
};

function article(overrides: Partial<ArticleFixture> = {}): ArticleFixture {
  return {
    id: "article-1",
    title: "Article One",
    source: "Source",
    status: ArticleStatus.PUBLISHED,
    content: "<p>Hello world. Next sentence!</p><p>Second paragraph.</p>",
    ...overrides,
  };
}

function captureConsole(t: { mock: typeof mock }) {
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  t.mock.method(console, "log", (message?: unknown) => logs.push(String(message ?? "")));
  t.mock.method(console, "warn", (message?: unknown) => warnings.push(String(message ?? "")));
  t.mock.method(console, "error", (message?: unknown) => errors.push(String(message ?? "")));
  return { logs, warnings, errors };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("batch synthesis CLI parsing", () => {
  test("parses loop flags and defaults", async () => {
    const { parseArgs } = await loadBatchSynthesis();

    const defaults = parseArgs(["--all"]);
    assert.equal(defaults.loop, false);
    assert.equal(defaults.sleepMs, 60_000);
    assert.equal(defaults.maxPasses, null);
    assert.equal(defaults.maxErrors, 5);
    assert.equal(defaults.limit, null);

    const args = parseArgs([
      "--all",
      "--loop",
      "--sleep",
      "250",
      "--max-passes",
      "3",
      "--max-errors",
      "2",
    ]);
    assert.equal(args.loop, true);
    assert.equal(args.sleepMs, 250);
    assert.equal(args.maxPasses, 3);
    assert.equal(args.maxErrors, 2);
    assert.equal(args.limit, 50);
  });

  test("parses all option families and invalid fallbacks", async (t) => {
    const { parseArgs } = await loadBatchSynthesis();
    t.mock.method(console, "warn", () => {});

    const args = parseArgs([
      "--ids",
      "article-1, article-2,article-1",
      "article-3",
      "--unknown",
      "--all",
      "--include-private",
      "--status",
      "published",
      "--source",
      "Source",
      "--limit",
      "2",
      "--include-existing",
      "--dry-run",
      "--submit-only",
      "--endpoint",
      "https://speech.example.test/",
      "--job-prefix",
      "Job Prefix",
      "--voice",
      "single-voice",
      "--voices",
      "voice-a,voice-b,voice-a",
      "--voice-mode",
      "random",
      "--list-hd-voices",
      "--hd",
      "--style",
      "cheerful",
      "--style-degree",
      "1.5",
      "--role",
      "YoungAdultFemale",
      "--rate",
      "fast",
      "--pitch",
      "+1st",
      "--volume",
      "soft",
      "--paragraph-break-ms",
      "100",
      "--sentence-break-ms",
      "50",
      "--max-chars",
      "25",
      "--format",
      "riff-16khz-16bit-mono-pcm",
      "--concatenate",
      "--ttl-hours",
      "24",
      "--poll-interval-ms",
      "5",
      "--timeout-ms",
      "10",
      "--max-inputs-per-job",
      "9",
      "--max-payload-bytes",
      "999",
    ]);

    assert.deepEqual(args.ids, ["article-1", "article-2", "article-3"]);
    assert.equal(args.status, "PUBLISHED");
    assert.equal(args.source, "Source");
    assert.equal(args.limit, 2);
    assert.equal(args.includeExisting, true);
    assert.equal(args.includePrivate, true);
    assert.equal(args.dryRun, true);
    assert.equal(args.submitOnly, true);
    assert.equal(args.endpoint, "https://speech.example.test/");
    assert.equal(args.jobPrefix, "Job Prefix");
    assert.equal(args.voice, "single-voice");
    assert.deepEqual(args.voices, ["voice-a", "voice-b"]);
    assert.equal(args.voiceMode, "random");
    assert.equal(args.listHdVoices, true);
    assert.equal(args.hd, true);
    assert.equal(args.style, "cheerful");
    assert.equal(args.styleDegree, 1.5);
    assert.equal(args.role, "YoungAdultFemale");
    assert.equal(args.rate, "fast");
    assert.equal(args.pitch, "+1st");
    assert.equal(args.volume, "soft");
    assert.equal(args.paragraphBreakMs, 100);
    assert.equal(args.sentenceBreakMs, 50);
    assert.equal(args.maxChars, 25);
    assert.equal(args.format, "riff-16khz-16bit-mono-pcm");
    assert.equal(args.concatenateResult, true);
    assert.equal(args.ttlHours, 24);
    assert.equal(args.pollIntervalMs, 5);
    assert.equal(args.timeoutMs, 10);
    assert.equal(args.maxInputsPerJob, 9);
    assert.equal(args.maxPayloadBytes, 999);

    const fallback = parseArgs([
      "--all",
      "--status",
      "bogus",
      "--voice-mode",
      "bogus",
      "--style-degree",
      "bogus",
      "--paragraph-break-ms",
      "0",
      "--sentence-break-ms",
      "0",
      "--max-chars",
      "bad",
      "--lowest-storage",
    ]);
    assert.equal(fallback.status, null);
    assert.equal(fallback.voiceMode, null);
    assert.equal(fallback.styleDegree, null);
    assert.equal(fallback.paragraphBreakMs, 450);
    assert.equal(fallback.sentenceBreakMs, null);
    assert.equal(fallback.maxChars, null);
    assert.equal(fallback.format, "audio-16khz-32kbitrate-mono-mp3");
  });

  test("clamps loop sleep to non-negative and treats max-passes 0 as unlimited", async () => {
    const { parseArgs } = await loadBatchSynthesis();

    const args = parseArgs(["--all", "--loop", "--sleep", "-1", "--max-passes", "0"]);
    assert.equal(args.sleepMs, 0);
    assert.equal(args.maxPasses, null);
  });

  test("validates incompatible or incomplete options", async () => {
    const { parseArgs, __batchSynthesisTest } = await loadBatchSynthesis();
    const validate = (argv: string[]) => __batchSynthesisTest.validateArgs(parseArgs(argv), argv);

    assert.equal(validate(["--list-hd-voices"]), null);
    assert.match(validate([]) ?? "", /Pass article ids or --all/);
    assert.match(validate(["--all", "--voice-mode", "bad"]) ?? "", /voice-mode/);
    assert.match(validate(["--all", "--role", "role"]) ?? "", /--role requires --style/);
    assert.match(validate(["--all", "--style-degree", "1"]) ?? "", /style-degree requires --style/);
    assert.match(
      validate(["--all", "--style", "calm", "--style-degree", "3"]) ?? "",
      /between 0.01 and 2/,
    );
    assert.match(validate(["--all", "--concatenate"]) ?? "", /incompatible with persistence/);
    assert.match(
      validate(["--all", "--max-payload-bytes", "2000001"]) ?? "",
      /2 MB request limit/,
    );
    assert.match(validate(["--all", "--max-inputs-per-job", "1001"]) ?? "", /<= 1000/);
    assert.match(validate(["--all", "--status", "NOPE"]) ?? "", /--status must be one of/);
    assert.equal(validate(["--all", "--status", "PUBLISHED"]), null);
  });
});

describe("batch synthesis selection and SSML helpers", () => {
  test("builds article filters and speech endpoints", async () => {
    const { parseArgs, __batchSynthesisTest } = await loadBatchSynthesis();

    const publicWhere = __batchSynthesisTest.articleWhere(parseArgs(["--all"]));
    assert.deepEqual(publicWhere, {
      ownerId: null,
      visibility: "PUBLIC",
      speech: { is: null },
    });

    const explicitWhere = __batchSynthesisTest.articleWhere(
      parseArgs([
        "--ids",
        "a,b",
        "--include-private",
        "--include-existing",
        "--status",
        "FAILED",
        "--source",
        "Undark",
      ]),
    );
    assert.deepEqual(explicitWhere, {
      id: { in: ["a", "b"] },
      status: "FAILED",
      source: "Undark",
    });

    assert.equal(
      __batchSynthesisTest.speechEndpoint(parseArgs(["--all", "--endpoint", "https://host/"]), "eastus"),
      "https://host",
    );
    process.env.AZURE_SPEECH_ENDPOINT = "https://env-host///";
    assert.equal(__batchSynthesisTest.speechEndpoint(parseArgs(["--all"]), "eastus"), "https://env-host");
    delete process.env.AZURE_SPEECH_ENDPOINT;
    assert.equal(
      __batchSynthesisTest.speechEndpoint(parseArgs(["--all"]), "westus"),
      "https://westus.api.cognitive.microsoft.com",
    );
  });

  test("builds SSML with voices, prosody, express-as, breaks, caps, and escaping", async () => {
    const { parseArgs, buildSsml, __batchSynthesisTest } = await loadBatchSynthesis();
    const row = article({
      content: "<p>Hello & welcome. Next sentence!</p><p>Second paragraph with extra text.</p>",
    });
    const args = parseArgs([
      "--all",
      "--voice",
      "voice&<>\"'",
      "--style",
      "cheerful",
      "--style-degree",
      "1.2",
      "--role",
      "role&",
      "--rate",
      "fast",
      "--pitch",
      "+1st",
      "--volume",
      "soft",
      "--sentence-break-ms",
      "25",
      "--paragraph-break-ms",
      "75",
      "--max-chars",
      "18",
    ]);

    const input = buildSsml(row, args, "configured", 0);
    assert.equal(input.article, row);
    assert.equal(input.voiceSummary, "rotate:voice&<>\"'");
    assert.equal(input.plainText.length <= 18, true);
    assert.match(input.content, /voice&amp;&lt;&gt;&quot;&apos;/);
    assert.match(input.content, /<mstts:express-as style="cheerful" styledegree="1.2" role="role&amp;">/);
    assert.match(input.content, /<prosody rate="fast" pitch="\+1st" volume="soft">/);
    assert.match(input.content, /<break time="25ms"\/>/);

    const defaultInput = buildSsml(article(), parseArgs(["--all"]), "configured", 0);
    assert.equal(defaultInput.voiceSummary, "rotate:configured");
    assert.match(defaultInput.content, /<voice name="configured">/);

    assert.deepEqual(__batchSynthesisTest.selectedVoices(parseArgs(["--all", "--voices", "a,b"]), "c"), [
      "a",
      "b",
    ]);
    assert.equal(__batchSynthesisTest.selectedVoices(parseArgs(["--all", "--hd"]), "c").length > 1, true);
    assert.equal(
      __batchSynthesisTest.effectiveVoiceMode(parseArgs(["--all", "--hd"]), ["a", "b"]),
      "random",
    );
    assert.equal(__batchSynthesisTest.randomVoice(["only"], null), "only");
    assert.equal(__batchSynthesisTest.randomVoice(["same", "same"], "same"), "same");
    assert.equal(__batchSynthesisTest.selectArticleVoice(["a", "b"], "rotate", 3), "b");
    assert.equal(["a", "b"].includes(__batchSynthesisTest.selectArticleVoice(["a", "b"], "random", 0)), true);
  });

  test("builds batch request bodies, chunks jobs, and maps MIME types", async () => {
    const { parseArgs, buildSsml, mimeTypeForFormat, __batchSynthesisTest } = await loadBatchSynthesis();
    const args = parseArgs([
      "--all",
      "--max-inputs-per-job",
      "1",
      "--job-prefix",
      "Bad Prefix! ",
      "--format",
      "ogg-opus",
      "--ttl-hours",
      "12",
      "--submit-only",
      "--concatenate",
    ]);
    const inputs = [buildSsml(article({ id: "a" }), args, "voice"), buildSsml(article({ id: "b" }), args, "voice")];

    const body = __batchSynthesisTest.batchRequestBody(args, inputs);
    assert.deepEqual((body as { properties: Record<string, unknown> }).properties, {
      outputFormat: "ogg-opus",
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
      concatenateResult: true,
      decompressOutputFiles: false,
      timeToLiveInHours: 12,
    });
    assert.equal(__batchSynthesisTest.bodySizeBytes(args, inputs) > 0, true);

    const jobs = __batchSynthesisTest.buildJobs(args, inputs);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].chunkIndex, 1);
    assert.match(jobs[0].id, /^bad-prefix-/);

    const oversizedArgs = { ...args, maxInputsPerJob: 1000, maxPayloadBytes: 1 };
    assert.throws(() => __batchSynthesisTest.buildJobs(oversizedArgs, [inputs[0]]), /exceeds the configured payload limit/);
    assert.match(__batchSynthesisTest.jobId("!!!", 2), /^readwise-batch-tts-/);
    assert.equal(mimeTypeForFormat("webm-24khz"), "audio/webm");
    assert.equal(mimeTypeForFormat("riff-16khz"), "audio/wav");
    assert.equal(mimeTypeForFormat("raw-format"), "application/octet-stream");
  });

  test("selects articles through Prisma with expected query shape", async () => {
    const { parseArgs, __batchSynthesisTest } = await loadBatchSynthesis();
    articleRows = [article({ id: "selected" })];

    const rows = await __batchSynthesisTest.selectArticles(
      parseArgs(["--all", "--status", "PUBLISHED", "--limit", "4"]),
    );

    assert.deepEqual(rows, articleRows);
    assert.deepEqual(lastFindManyArgs, {
      where: {
        ownerId: null,
        visibility: "PUBLIC",
        status: "PUBLISHED",
        speech: { is: null },
      },
      orderBy: { createdAt: "asc" },
      take: 4,
      select: {
        id: true,
        title: true,
        source: true,
        status: true,
        content: true,
      },
    });
  });
});

describe("batch synthesis Azure and result helpers", () => {
  test("requests JSON, submits jobs, polls outcomes, and downloads ZIP bytes", async (t) => {
    const { parseArgs, buildSsml, __batchSynthesisTest } = await loadBatchSynthesis();
    const { logs } = captureConsole(t);
    const fetches: Array<{ url: string; init: RequestInit | undefined }> = [];
    const responses = [
      jsonResponse({ ok: true }),
      new Response("", { status: 200 }),
      new Response("bad request", { status: 400 }),
      jsonResponse({ status: "Running" }),
      jsonResponse({ id: "job-1", status: "Running" }),
      jsonResponse({ status: "Running" }),
      jsonResponse({ status: "Succeeded", outputs: { result: "https://result.test/zip" } }),
      jsonResponse({ status: "Failed" }),
      new Response("zip-bytes", { status: 200 }),
      new Response("missing", { status: 404 }),
    ];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      const response = responses.shift();
      assert.ok(response, `unexpected fetch ${String(url)}`);
      return response;
    });

    assert.deepEqual(
      await __batchSynthesisTest.requestJson("https://api.test/json", { method: "GET" }),
      { ok: true },
    );
    assert.equal(await __batchSynthesisTest.requestJson("https://api.test/empty", { method: "GET" }), null);
    await assert.rejects(
      () => __batchSynthesisTest.requestJson("https://api.test/fail", { method: "GET" }),
      /HTTP 400: bad request/,
    );

    const args = parseArgs(["--all", "--poll-interval-ms", "1", "--timeout-ms", "2000"]);
    const input = buildSsml(article(), args, "voice");
    const job = { chunkIndex: 1, id: "job/with spaces", inputs: [input] };
    await __batchSynthesisTest.createBatchJob("https://endpoint.test", "key", args, job);
    assert.match(logs.join("\n"), /submitted job\/with spaces/);
    assert.match(fetches[3].url, /job%2Fwith%20spaces/);
    assert.equal(fetches[3].init?.method, "PUT");

    assert.deepEqual(await __batchSynthesisTest.getBatchJob("https://endpoint.test", "key", "job-1"), {
      id: "job-1",
      status: "Running",
    });
    assert.deepEqual(await __batchSynthesisTest.waitForBatchJob("https://endpoint.test", "key", args, "job-2"), {
      status: "Succeeded",
      outputs: { result: "https://result.test/zip" },
    });
    await assert.rejects(
      () => __batchSynthesisTest.waitForBatchJob("https://endpoint.test", "key", args, "job-3"),
      /job failed/,
    );
    await assert.rejects(
      () =>
        __batchSynthesisTest.waitForBatchJob(
          "https://endpoint.test",
          "key",
          { ...args, timeoutMs: 0 },
          "job-4",
        ),
      /Timed out/,
    );

    const zipPath = path.join(TEST_ARTIFACT_ROOT, "result.zip");
    await __batchSynthesisTest.downloadResultZip("https://result.test/zip", "key", zipPath);
    await assert.rejects(
      () => __batchSynthesisTest.downloadResultZip("https://result.test/missing", "key", zipPath),
      /HTTP 404/,
    );
  });

  test("finds files, parses batch words, and enriches word spans", async () => {
    const { __batchSynthesisTest } = await loadBatchSynthesis();
    const nested = path.join(TEST_ARTIFACT_ROOT, "out", "nested");
    await mkdir(nested, { recursive: true });
    const audioPath = path.join(TEST_ARTIFACT_ROOT, "out", "0001.audio.mp3");
    const debugPath = path.join(TEST_ARTIFACT_ROOT, "out", "0001.debug.txt");
    const wordPath = path.join(nested, "0001.word.json");
    await writeFile(audioPath, "audio");
    await writeFile(debugPath, "debug");
    // TextOffset/WordLength/TextLength are character indices (not ticks).
    // AudioOffset and Duration are already in milliseconds in the Batch REST API
    // response (unlike the real-time SDK, which uses 100-ns ticks).
    await writeFile(
      wordPath,
      JSON.stringify([
        { Text: "world", AudioOffset: 20, Duration: 5, TextOffset: 6, TextLength: 5 },
        { Text: "Hello", AudioOffset: 0, Duration: 10, TextOffset: 0, WordLength: 5 },
        { Text: "bad", AudioOffset: -1, Duration: 1 },
      ]),
    );

    const files = await __batchSynthesisTest.listFiles(path.join(TEST_ARTIFACT_ROOT, "out"));
    assert.equal(files.includes(audioPath), true);
    assert.equal(__batchSynthesisTest.prefixForIndex(0), "0001");
    assert.equal(__batchSynthesisTest.findBatchFile(files, 0, "audio"), audioPath);
    assert.equal(__batchSynthesisTest.findBatchFile(files, 0, "word"), wordPath);
    assert.equal(__batchSynthesisTest.findBatchFile(files, 1, "audio"), null);

    const parsed = await __batchSynthesisTest.parseBatchResult(files, 0);
    assert.equal(parsed.audio.toString(), "audio");
    // AudioOffset/Duration already in ms; stored directly: startMs=0, endMs=10; startMs=20, endMs=25
    assert.deepEqual(parsed.words, [
      { word: "Hello", startMs: 0, endMs: 10, textStart: 0, textEnd: 5 },
      { word: "world", startMs: 20, endMs: 25, textStart: 6, textEnd: 11 },
    ]);
    await assert.rejects(() => __batchSynthesisTest.parseBatchResult(files, 1), /missing audio file/);

    assert.deepEqual(__batchSynthesisTest.parseBatchWords("not-array"), []);
    assert.deepEqual(
      __batchSynthesisTest.parseBatchWords([
        { Text: "later", AudioOffset: 5, Duration: 2 },
        { Text: "first", AudioOffset: 1, Duration: 2 },
        { Text: 1, AudioOffset: 1, Duration: 2 },
        { Text: "bad-duration", AudioOffset: 1, Duration: Number.NaN },
      ]),
      [
        { word: "first", startMs: 1, endMs: 3 },
        { word: "bad-duration", startMs: 1, endMs: Number.NaN },
        { word: "later", startMs: 5, endMs: 7 },
      ],
    );

    assert.deepEqual(__batchSynthesisTest.enrichBatchWordsWithTextSpans([], "plain"), []);
    const alreadySpanned = [{ word: "Hello", startMs: 0, endMs: 1, textStart: 0, textEnd: 5 }];
    assert.equal(__batchSynthesisTest.enrichBatchWordsWithTextSpans(alreadySpanned, "Hello"), alreadySpanned);
    const enriched = __batchSynthesisTest.enrichBatchWordsWithTextSpans(
      [
        { word: "Hello", startMs: 0, endMs: 1 },
        { word: "world", startMs: 1, endMs: 2 },
      ],
      "Hello world",
    );
    assert.deepEqual(
      enriched.map((word: { textStart?: number; textEnd?: number }) => [word.textStart, word.textEnd]),
      [
        [0, 5],
        [6, 11],
      ],
    );

    // Zero-duration words that cannot be aligned are excluded (timing markers)
    const withZeroDur = __batchSynthesisTest.enrichBatchWordsWithTextSpans(
      [
        { word: "Hello", startMs: 0, endMs: 100 },
        { word: "\u200b", startMs: 100, endMs: 100 }, // zero-dur invisible marker
        { word: "world", startMs: 100, endMs: 200 },
      ],
      "Hello world",
    );
    assert.equal(withZeroDur.length, 2); // marker excluded
    assert.ok(withZeroDur.every((w: { textStart?: number; textEnd?: number }) =>
      typeof w.textStart === "number" && typeof w.textEnd === "number",
    ));

    // Non-zero-duration words not found in plainText receive neighbour fallback spans
    const withExpansion = __batchSynthesisTest.enrichBatchWordsWithTextSpans(
      [
        { word: "about", startMs: 0, endMs: 100 },
        { word: "twenty", startMs: 100, endMs: 200 }, // TTS expansion of "20"
        { word: "million", startMs: 200, endMs: 300 },
      ],
      "about 20 million",
    );
    assert.equal(withExpansion.length, 3); // expansion kept with fallback
    const twentyWord = withExpansion.find((w: { word: string }) => w.word === "twenty");
    assert.ok(twentyWord !== undefined);
    assert.ok(typeof twentyWord.textStart === "number" && typeof twentyWord.textEnd === "number");
    assert.ok(twentyWord.textEnd > twentyWord.textStart);
  });

  test("persists job results with injectable filesystem dependencies and graceful save fallback", async () => {
    const { parseArgs, buildSsml, __batchSynthesisTest } = await loadBatchSynthesis();
    const args = parseArgs(["--all", "--format", "audio-16khz-32kbitrate-mono-mp3"]);
    const inputs = [
      buildSsml(article({ id: "save-me" }), args, "voice"),
      buildSsml(article({ id: "skip-me" }), args, "voice"),
    ];
    const calls: string[] = [];
    const warnings: string[] = [];
    const saved = await __batchSynthesisTest.persistJobResults(
      { chunkIndex: 1, id: "job", inputs },
      "https://result.test/zip",
      "key",
      args,
      {
        tempRoot: TEST_ARTIFACT_ROOT,
        downloadResultZip: async (url: string, key: string, targetPath: string) => {
          calls.push(`download:${url}:${key}:${path.basename(targetPath)}`);
        },
        execFileAsync: async (command: string, commandArgs: readonly string[] | null = []) => {
          calls.push(`exec:${command}:${(commandArgs ?? []).join(" ")}`);
          return { stdout: "", stderr: "" };
        },
        listFiles: async (root: string) => {
          calls.push(`list:${path.basename(root)}`);
          return ["ignored"];
        },
        parseBatchResult: async (_files: string[], index: number) => ({
          audio: Buffer.from(`audio-${index}`),
          words: [{ word: index === 0 ? "Hello" : "Second", startMs: 0, endMs: 1 }],
        }),
        saveSpeechResult: async (input: { articleId: string }) => {
          savedSpeechInputs.push(input);
          return input.articleId === "save-me";
        },
        logger: {
          log: (message: string) => calls.push(message),
          warn: (message: string) => warnings.push(message),
        },
      },
    );

    assert.equal(saved, 1);
    assert.deepEqual(savedSpeechInputs.map((input) => (input as { articleId: string }).articleId), [
      "save-me",
      "skip-me",
    ]);
    assert.match(calls.join("\n"), /download:https:\/\/result\.test\/zip:key:results\.zip/);
    assert.match(calls.join("\n"), /exec:unzip:-q .* -d .*/);
    assert.match(calls.join("\n"), /saved ArticleSpeech article=save-me words=1 bytes=7/);
    assert.match(warnings.join("\n"), /media-storage-unavailable/);
  });
});

describe("batch synthesis runOnce and loop orchestration", () => {
  test("handles empty selections, empty reader text, and dry-run summaries", async (t) => {
    const { parseArgs, runOnce } = await loadBatchSynthesis();
    const { logs } = captureConsole(t);

    assert.deepEqual(await runOnce(parseArgs(["--all"]), speechRuntimeConfig!), {
      selected: 0,
      submitted: 0,
      persisted: 0,
    });
    assert.match(logs.join("\n"), /No articles selected/);

    articleRows = [article({ content: "<p> </p>" })];
    assert.deepEqual(await runOnce(parseArgs(["--all"]), speechRuntimeConfig!), {
      selected: 1,
      submitted: 0,
      persisted: 0,
    });
    assert.match(logs.join("\n"), /No articles with synthesizable reader text selected/);

    articleRows = [article({ id: "a" }), article({ id: "b" })];
    assert.deepEqual(
      await runOnce(parseArgs(["--all", "--dry-run", "--max-inputs-per-job", "1"]), speechRuntimeConfig!),
      {
        selected: 2,
        submitted: 2,
        persisted: 0,
      },
    );
    assert.match(logs.join("\n"), /Selected 2 article\(s\)/);
    assert.match(logs.join("\n"), /estimated request payload bytes=/);
  });

  test("submits only when requested and warns before failing without persistence output", async (t) => {
    const { parseArgs, runOnce } = await loadBatchSynthesis();
    const { warnings } = captureConsole(t);
    articleRows = [article()];
    const responses = [
      jsonResponse({ status: "Accepted" }),
      jsonResponse({ status: "Accepted" }),
      jsonResponse({ status: "Succeeded" }),
    ];
    t.mock.method(globalThis, "fetch", async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    });

    assert.deepEqual(await runOnce(parseArgs(["--all", "--submit-only"]), speechRuntimeConfig!), {
      selected: 1,
      submitted: 1,
      persisted: 0,
    });

    await assert.rejects(
      () => runOnce(parseArgs(["--all", "--poll-interval-ms", "0", "--timeout-ms", "50"]), speechRuntimeConfig!),
      /succeeded without outputs.result/,
    );
    assert.match(warnings.join("\n"), /Media storage is unavailable/);
  });

  test("stops after max passes", async () => {
    const { parseArgs, runLoop } = await loadBatchSynthesis();
    const args = parseArgs(["--all", "--loop", "--max-passes", "3", "--sleep", "0"]);
    const controller = new AbortController();
    let calls = 0;
    let sleeps = 0;

    const code = await runLoop(args, {
      signal: controller.signal,
      logger: silentLogger(),
      sleep: async () => {
        sleeps++;
      },
      runPass: async () => {
        calls++;
        return successfulPassResult();
      },
    });

    assert.equal(code, 0);
    assert.equal(calls, 3);
    assert.equal(sleeps, 2);
  });

  test("aborts after max consecutive errors", async () => {
    const { parseArgs, runLoop } = await loadBatchSynthesis();
    const args = parseArgs([
      "--all",
      "--loop",
      "--max-passes",
      "10",
      "--max-errors",
      "2",
      "--sleep",
      "0",
    ]);
    let calls = 0;

    const code = await runLoop(args, {
      signal: new AbortController().signal,
      logger: silentLogger(),
      sleep: async () => {},
      runPass: async () => {
        calls++;
        throw new Error("synthetic failure");
      },
    });

    assert.equal(code, 1);
    assert.equal(calls, 2);
  });

  test("resets consecutive error counter after a success", async () => {
    const { parseArgs, runLoop } = await loadBatchSynthesis();
    const args = parseArgs([
      "--all",
      "--loop",
      "--max-passes",
      "4",
      "--max-errors",
      "2",
      "--sleep",
      "0",
    ]);
    const outcomes = ["fail", "success", "fail", "fail"];
    let calls = 0;

    const code = await runLoop(args, {
      signal: new AbortController().signal,
      logger: silentLogger(),
      sleep: async () => {},
      runPass: async () => {
        const outcome = outcomes[calls++];
        if (outcome === "fail") throw new Error("synthetic failure");
        return successfulPassResult();
      },
    });

    assert.equal(code, 1);
    assert.equal(calls, 4);
  });

  test("stops when aborted and abortable sleep resolves on abort", async () => {
    const { parseArgs, runLoop, abortableSleep } = await loadBatchSynthesis();
    const controller = new AbortController();
    let calls = 0;
    const code = await runLoop(parseArgs(["--all", "--loop", "--sleep", "1"]), {
      signal: controller.signal,
      logger: silentLogger(),
      sleep: async (_ms, signal) => {
        assert.equal(signal.aborted, false);
        controller.abort();
      },
      runPass: async () => {
        calls++;
        return successfulPassResult();
      },
    });
    assert.equal(code, 0);
    assert.equal(calls, 1);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await abortableSleep(10, alreadyAborted.signal);
    await abortableSleep(0, new AbortController().signal);

    const sleeping = new AbortController();
    const slept = abortableSleep(1000, sleeping.signal);
    sleeping.abort();
    await slept;
  });
});

describe("batch synthesis main entry orchestration", () => {
  async function withArgv(argv: string[], action: () => Promise<number>) {
    const previous = process.argv;
    process.argv = ["node", "scripts/batch-synthesis.ts", ...argv];
    try {
      return await action();
    } finally {
      process.argv = previous;
    }
  }

  test("handles help, HD voice listing, validation, disabled feature, and missing config", async (t) => {
    const { __batchSynthesisTest } = await loadBatchSynthesis();
    const { logs, errors } = captureConsole(t);

    assert.equal(await withArgv(["--help"], () => __batchSynthesisTest.main()), 0);
    assert.match(logs.join("\n"), /ReadWise Azure Batch Synthesis/);
    assert.equal(await withArgv(["--list-hd-voices"], () => __batchSynthesisTest.main()), 0);
    assert.match(logs.join("\n"), /Built-in English DragonHD voice preset/);
    assert.equal(await withArgv([], () => __batchSynthesisTest.main()), 1);
    assert.match(errors.join("\n"), /Pass article ids or --all/);

    ttsEnabled = false;
    assert.equal(await withArgv(["--all"], () => __batchSynthesisTest.main()), 1);
    assert.match(errors.join("\n"), /FEATURE_TTS_ENABLED is disabled/);

    ttsEnabled = true;
    speechRuntimeConfig = null;
    assert.equal(await withArgv(["--all"], () => __batchSynthesisTest.main()), 1);
    assert.match(errors.join("\n"), /Azure Speech is not configured/);
  });

  test("runs single-pass dry runs and loop mode through main", async (t) => {
    const { __batchSynthesisTest } = await loadBatchSynthesis();
    captureConsole(t);
    articleRows = [article()];

    assert.equal(await withArgv(["--all", "--dry-run"], () => __batchSynthesisTest.main()), 0);
    assert.equal(
      await withArgv(
        ["--all", "--loop", "--dry-run", "--max-passes", "1", "--sleep", "0"],
        () => __batchSynthesisTest.main(),
      ),
      0,
    );
  });
});
