process.env.LOG_LEVEL = "error";

import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
let extractedBatchResults: Array<{ audio: Buffer; words: unknown }> = [];
let saveSpeechResultImpl = async (input: unknown) => {
  savedSpeechInputs.push(input);
  return true;
};

before(() => {
  mock.module("node:child_process", {
    namedExports: {
      execFile: (
        _command: string,
        commandArgs: readonly string[],
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const outputFlagIndex = commandArgs.indexOf("-d");
        const outputDirectory = commandArgs[outputFlagIndex + 1];
        assert.ok(outputDirectory, "unzip output directory is required");
        void (async () => {
          await mkdir(outputDirectory, { recursive: true });
          await Promise.all(
            extractedBatchResults.flatMap((result, index) => {
              const prefix = String(index + 1).padStart(4, "0");
              return [
                writeFile(path.join(outputDirectory, `${prefix}.audio.mp3`), result.audio),
                writeFile(
                  path.join(outputDirectory, `${prefix}.word.json`),
                  JSON.stringify(result.words),
                ),
              ];
            }),
          );
        })().then(
          () => callback(null, "", ""),
          (error: Error) => callback(error, "", ""),
        );
      },
    },
  });
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
  extractedBatchResults = [];
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

async function loadAzureBatchSynthesis() {
  return import("@/lib/speech/azure-batch-synthesis");
}

async function runBatchSynthesis(argv: string[]) {
  const [{ parseArgs }, { runAzureBatchSynthesis }] = await Promise.all([
    loadBatchSynthesis(),
    loadAzureBatchSynthesis(),
  ]);
  assert.ok(speechRuntimeConfig, "speech config is required");
  return runAzureBatchSynthesis(parseArgs(argv), speechRuntimeConfig);
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
    const { parseArgs, validateArgs } = await loadBatchSynthesis();
    const validate = (argv: string[]) => validateArgs(parseArgs(argv), argv);

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

describe("Azure Batch synthesis interface", () => {
  test("selects public articles and plans jobs through one interface", async (t) => {
    const { logs } = captureConsole(t);
    articleRows = [article({ id: "selected" })];

    const result = await runBatchSynthesis([
      "--all",
      "--status",
      "PUBLISHED",
      "--limit",
      "4",
      "--dry-run",
    ]);

    assert.deepEqual(result, { selected: 1, submitted: 1, persisted: 0 });
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
    assert.match(logs.join("\n"), /Selected 1 article\(s\)/);

    await runBatchSynthesis([
      "--ids",
      "a,b",
      "--include-private",
      "--include-existing",
      "--status",
      "FAILED",
      "--source",
      "Undark",
      "--dry-run",
    ]);
    assert.deepEqual((lastFindManyArgs as { where: unknown }).where, {
      id: { in: ["a", "b"] },
      status: "FAILED",
      source: "Undark",
    });
  });

  test("submits escaped SSML and Azure properties through one interface", async (t) => {
    articleRows = [
      article({
        content: "<p>Hello & welcome. Next sentence!</p><p>Second paragraph with extra text.</p>",
      }),
    ];
    const fetches: Array<{ url: string; init?: RequestInit }> = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      return jsonResponse({ status: "Accepted" });
    });

    await runBatchSynthesis([
      "--all",
      "--submit-only",
      "--endpoint",
      "https://host/",
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

    assert.equal(fetches.length, 1);
    assert.match(fetches[0]!.url, /^https:\/\/host\/texttospeech\/batchsyntheses\//);
    const body = JSON.parse(String(fetches[0]!.init?.body)) as {
      inputs: Array<{ content: string }>;
      properties: Record<string, unknown>;
    };
    const content = body.inputs[0]!.content;
    assert.match(content, /voice&amp;&lt;&gt;&quot;&apos;/);
    assert.match(content, /<mstts:express-as style="cheerful" styledegree="1.2" role="role&amp;">/);
    assert.match(content, /<prosody rate="fast" pitch="\+1st" volume="soft">/);
    assert.doesNotMatch(content, /Second paragraph/);
    assert.deepEqual(body.properties, {
      outputFormat: "audio-16khz-32kbitrate-mono-mp3",
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
      concatenateResult: false,
      decompressOutputFiles: false,
      timeToLiveInHours: 168,
    });
  });

  test("strips XML-invalid control characters (e.g. null bytes) from SSML content", async (t) => {
    articleRows = [
      article({
        content: "<p>Hello\x00world. Null\x00byte\x00s.</p><p>Para\x01graph\x0E two.</p>",
      }),
    ];
    const fetches: Array<{ url: string; init?: RequestInit }> = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      return jsonResponse({ status: "Accepted" });
    });

    await runBatchSynthesis(["--all", "--submit-only"]);

    assert.equal(fetches.length, 1);
    const body = JSON.parse(String(fetches[0]!.init?.body)) as {
      inputs: Array<{ content: string }>;
    };
    const content = body.inputs[0]!.content;
    assert.doesNotMatch(content, /\x00/);
    assert.doesNotMatch(content, /\x01/);
    assert.doesNotMatch(content, /\x0E/);
    assert.match(content, /Helloworld/);
    assert.match(content, /Nullbytes/);
  });

  test("chunks submitted jobs and rejects an oversized article", async (t) => {
    articleRows = [article({ id: "a" }), article({ id: "b" })];
    const fetches: Array<{ url: string; init?: RequestInit }> = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      return jsonResponse({ status: "Accepted" });
    });

    const result = await runBatchSynthesis([
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

    assert.deepEqual(result, { selected: 2, submitted: 2, persisted: 0 });
    assert.equal(fetches.length, 2);
    assert.ok(fetches.every(({ url }) => /\/bad-prefix-/.test(url)));
    const properties = JSON.parse(String(fetches[0]!.init?.body)).properties;
    assert.deepEqual(properties, {
      outputFormat: "ogg-opus",
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
      concatenateResult: true,
      decompressOutputFiles: false,
      timeToLiveInHours: 12,
    });

    articleRows = [article({ id: "oversized" })];
    await assert.rejects(
      () => runBatchSynthesis(["--all", "--dry-run", "--max-payload-bytes", "1"]),
      /exceeds the configured payload limit/,
    );
  });
});

describe("Azure Batch synthesis remote and persistence behavior", () => {
  test("normalizes submission, polling, timeout, and download failures", async (t) => {
    articleRows = [article()];
    let responses: Response[] = [];
    t.mock.method(globalThis, "fetch", async () => {
      const response = responses.shift();
      assert.ok(response, "unexpected Azure request");
      return response;
    });

    responses = [new Response("bad request", { status: 400 })];
    await assert.rejects(
      () => runBatchSynthesis(["--all", "--submit-only"]),
      /HTTP 400: bad request/,
    );

    responses = [jsonResponse({ status: "Accepted" }), jsonResponse({ status: "Failed" })];
    await assert.rejects(
      () => runBatchSynthesis(["--all", "--poll-interval-ms", "1"]),
      /job failed/,
    );

    responses = [jsonResponse({ status: "Accepted" }), jsonResponse({ status: "Running" })];
    await assert.rejects(
      () => runBatchSynthesis(["--all", "--poll-interval-ms", "1", "--timeout-ms", "1"]),
      /Timed out/,
    );

    responses = [
      jsonResponse({ status: "Accepted" }),
      jsonResponse({ status: "Succeeded", outputs: { result: "https://result.test/missing" } }),
      new Response("missing", { status: 404 }),
    ];
    await assert.rejects(
      () => runBatchSynthesis(["--all", "--poll-interval-ms", "1"]),
      /result ZIP: HTTP 404/,
    );
  });

  test("downloads, parses, enriches, persists, and cleans up through one interface", async (t) => {
    const { warnings } = captureConsole(t);
    storageConfigured = true;
    articleRows = [
      article({ id: "save-me", content: "<p>Hello world.</p>" }),
      article({ id: "skip-me", content: "<p>Second article.</p>" }),
    ];
    extractedBatchResults = [
      {
        audio: Buffer.from("audio-one"),
        words: [
          { Text: "world", AudioOffset: 20, Duration: 5 },
          { Text: "Hello", AudioOffset: 0, Duration: 10 },
          { Text: "bad", AudioOffset: -1, Duration: 1 },
        ],
      },
      {
        audio: Buffer.from("audio-two"),
        words: [
          { Text: "Second", AudioOffset: 0, Duration: 10, TextOffset: 0, WordLength: 6 },
          { Text: "article", AudioOffset: 10, Duration: 10, TextOffset: 7, TextLength: 7 },
        ],
      },
    ];
    saveSpeechResultImpl = async (input: unknown) => {
      savedSpeechInputs.push(input);
      return (input as { articleId: string }).articleId === "save-me";
    };
    const fetches: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({ status: "Accepted" }),
      jsonResponse({ status: "Running" }),
      jsonResponse({ status: "Succeeded", outputs: { result: "https://result.test/archive" } }),
      new Response("zip-bytes", { status: 200 }),
    ];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      const response = responses.shift();
      assert.ok(response, `unexpected fetch ${String(url)}`);
      return response;
    });

    const result = await runBatchSynthesis([
      "--all",
      "--poll-interval-ms",
      "1",
      "--timeout-ms",
      "2000",
      "--max-chars",
      "11",
    ]);

    assert.deepEqual(result, { selected: 2, submitted: 1, persisted: 1 });
    assert.equal(fetches.at(-1)?.url, "https://result.test/archive");
    assert.deepEqual(
      savedSpeechInputs.map((input) => (input as { articleId: string }).articleId),
      ["save-me", "skip-me"],
    );
    const saved = savedSpeechInputs[0] as {
      audio: Buffer;
      mimeType: string;
      provider: string;
      textBasis?: unknown;
      words: Array<{
        word: string;
        startMs: number;
        endMs: number;
        textStart?: number;
        textEnd?: number;
      }>;
    };
    assert.equal(saved.audio.toString(), "audio-one");
    assert.equal(saved.mimeType, "audio/mpeg");
    assert.equal(saved.provider, "azure-batch");
    assert.deepEqual(saved.textBasis, { kind: "paragraph-limit", maxChars: 11 });
    assert.deepEqual(saved.words, [
      { word: "Hello", startMs: 0, endMs: 10, textStart: 0, textEnd: 5 },
      { word: "world", startMs: 20, endMs: 25, textStart: 6, textEnd: 11 },
    ]);
    assert.match(warnings.join("\n"), /media-storage-unavailable/);
    assert.deepEqual(await readdir(TEST_ARTIFACT_ROOT), []);
  });
});

describe("batch synthesis runOnce and loop orchestration", () => {
  test("handles empty selections, empty reader text, and dry-run summaries", async (t) => {
    const { parseArgs } = await loadBatchSynthesis();
    const { runAzureBatchSynthesis: runOnce } = await loadAzureBatchSynthesis();
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
    const { parseArgs } = await loadBatchSynthesis();
    const { runAzureBatchSynthesis: runOnce } = await loadAzureBatchSynthesis();
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
    const { main } = await loadBatchSynthesis();
    const { logs, errors } = captureConsole(t);

    assert.equal(await withArgv(["--help"], () => main()), 0);
    assert.match(logs.join("\n"), /ReadWise Azure Batch Synthesis/);
    assert.equal(await withArgv(["--list-hd-voices"], () => main()), 0);
    assert.match(logs.join("\n"), /Built-in English DragonHD voice preset/);
    assert.equal(await withArgv([], () => main()), 1);
    assert.match(errors.join("\n"), /Pass article ids or --all/);

    ttsEnabled = false;
    assert.equal(await withArgv(["--all"], () => main()), 1);
    assert.match(errors.join("\n"), /FEATURE_TTS_ENABLED is disabled/);

    ttsEnabled = true;
    speechRuntimeConfig = null;
    assert.equal(await withArgv(["--all"], () => main()), 1);
    assert.match(errors.join("\n"), /Azure Speech is not configured/);
  });

  test("runs single-pass dry runs and loop mode through main", async (t) => {
    const { main } = await loadBatchSynthesis();
    captureConsole(t);
    articleRows = [article()];

    assert.equal(await withArgv(["--all", "--dry-run"], () => main()), 0);
    assert.equal(
      await withArgv(
        ["--all", "--loop", "--dry-run", "--max-passes", "1", "--sleep", "0"],
        () => main(),
      ),
      0,
    );
  });
});
