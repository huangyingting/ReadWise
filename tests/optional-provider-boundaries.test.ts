process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ModuleConfig = {
  name: "speech" | "push" | "jobs" | "today-session";
  alias: string;
  relativeDir: string;
  dir: string;
  expectedExports: string[];
  forbiddenExports: string[];
  privateInternalImports: string[];
};

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "..");
const SRC_DIR = resolve(ROOT_DIR, "src");

const MODULES: ModuleConfig[] = [
  {
    name: "speech",
    alias: "@/lib/speech",
    relativeDir: "src/lib/speech",
    dir: resolve(ROOT_DIR, "src/lib/speech"),
    expectedExports: [
      "getArticleSpeechAudio",
      "getOrCreateArticleSpeech",
      "isSpeechConfigured",
    ],
    forbiddenExports: ["synthesize", "resolveMimeType", "saveSpeechResult", "resolveStoredSpeechMediaMetadata"],
    privateInternalImports: ["@/lib/speech/provider-azure", "@/lib/speech/repository"],
  },
  {
    name: "push",
    alias: "@/lib/push",
    relativeDir: "src/lib/push",
    dir: resolve(ROOT_DIR, "src/lib/push"),
    expectedExports: [
      "isPushConfigured",
      "rawObjectBody",
      "subscribeBody",
      "subscribePush",
      "unsubscribeBody",
      "unsubscribePush",
      "vapidPublicKey",
    ],
    forbiddenExports: [
      "ensurePushInit",
      "sendWebPushNotification",
      "recordDeliverySuccess",
      "recordTransientFailure",
      "pruneDeadSubscriptions",
      "sendDueReminders",
      "sendPushToUser",
      "sendToSubs",
    ],
    privateInternalImports: ["@/lib/push/delivery", "@/lib/push/subscription-health"],
  },
  {
    name: "jobs",
    alias: "@/lib/jobs",
    relativeDir: "src/lib/jobs",
    dir: resolve(ROOT_DIR, "src/lib/jobs"),
    expectedExports: [
      "ACTIVE_STATUSES",
      "CANDIDATE_INGEST_DEDUPE_PREFIX",
      "CANDIDATE_INGEST_PROCESSING_VERSION",
      "DEFAULT_LOCK_TTL_MS",
      "DEFAULT_RETRY_POLICY",
      "JOB_TERMINAL_STATUSES",
      "JobError",
      "JobStatus",
      "JobType",
      "MIN_LOCK_TTL_MS",
      "RECLAIMABLE_STATUSES",
      "RETRY_POLICIES",
      "ROLLBACK_CANCELLED_REASON",
      "RUNNABLE_STATUSES",
      "TERMINAL_STATUSES",
      "archiveJob",
      "articleProcessDedupeKey",
      "buildCandidateIngestPayload",
      "cancelJob",
      "cancelPendingCandidateIngestJobsInTx",
      "candidateIngestDedupeKey",
      "claimNextJob",
      "classifyJobError",
      "completeJob",
      "countJobsByStatus",
      "countJobsByType",
      "countJobsByTypeAndStatus",
      "enqueueAiRebuild",
      "enqueueArticleIngest",
      "enqueueArticleProcess",
      "enqueueArticleProcessInTx",
      "enqueueCandidateIngestInTx",
      "enqueueJob",
      "enqueueJobInTx",
      "enqueuePushReminder",
      "enqueueTtsGenerate",
      "failJob",
      "getJob",
      "heartbeatJob",
      "isCandidateIngestPayload",
      "jobBackoffDelay",
      "jobTerminalRetentionDays",
      "listDeadLetterJobs",
      "listJobs",
      "parseCandidateIngestPayload",
      "pruneTerminalJobs",
      "refreshJobQueueDepthMetrics",
      "retryJob",
      "retryPolicyFor",
      "startJob",
    ],
    forbiddenExports: [
      "claimNextJobPostgres",
      "claimNextJobGeneric",
      "runJobAction",
      "getJobDashboard",
      "listAdminJobs",
    ],
    privateInternalImports: ["@/lib/jobs/claim-generic", "@/lib/jobs/claim-postgres"],
  },
  {
    name: "today-session",
    alias: "@/lib/engagement/today-session",
    relativeDir: "src/lib/engagement/today-session",
    dir: resolve(ROOT_DIR, "src/lib/engagement/today-session"),
    expectedExports: ["loadTodayComprehensionCheck", "loadTodayViewModel"],
    forbiddenExports: [
      "buildTodayPlan",
      "createTodaySession",
      "emitTodaySessionViewed",
      "getOrCreateTodaySession",
      "getTodaySession",
      "recomputeTodayCompletion",
      "selectTargetWordIds",
      "updateTodaySession",
    ],
    privateInternalImports: [
      "@/lib/engagement/today-session/analytics",
      "@/lib/engagement/today-session/completion",
      "@/lib/engagement/today-session/comprehension",
      "@/lib/engagement/today-session/feature-gate",
      "@/lib/engagement/today-session/generator",
      "@/lib/engagement/today-session/local-date",
      "@/lib/engagement/today-session/repository",
      "@/lib/engagement/today-session/set-article",
      "@/lib/engagement/today-session/skip",
      "@/lib/engagement/today-session/target-words",
      "@/lib/engagement/today-session/types",
      "@/lib/engagement/today-session/view-model",
    ],
  },
];

const BARREL_SUFFIXES = new Set(["", "/index"]);

function walkFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) {
      continue;
    }
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relPath(absPath: string): string {
  return relative(ROOT_DIR, absPath).replaceAll("\\", "/");
}

function parseModuleSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const importOrExport = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const requireCall = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [importOrExport, dynamicImport, requireCall]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      specs.add(match[1] ?? "");
    }
  }
  return [...specs];
}

function resolveModuleImport(importer: string, specifier: string, config: ModuleConfig): string | null {
  const candidates: string[] = [];

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = resolve(dirname(importer), specifier);
    candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx"));
  } else if ([...BARREL_SUFFIXES].some((suffix) => specifier === `${config.alias}${suffix}`)) {
    candidates.push(resolve(config.dir, "index.ts"));
  } else if (specifier.startsWith(`${config.alias}/`)) {
    const sub = specifier.slice(`${config.alias}/`.length);
    const base = resolve(config.dir, sub);
    candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx"));
  } else {
    return null;
  }

  for (const candidate of candidates) {
    try {
      const rel = relPath(candidate);
      if (rel.startsWith(`${config.relativeDir}/`)) {
        readFileSync(candidate, "utf8");
        return rel;
      }
    } catch {
      // Candidate missing; continue.
    }
  }

  return null;
}

function detectCycles(graph: Map<string, string[]>): string[][] {
  const cycles = new Set<string>();

  function normalizeCycle(nodes: string[]): string {
    const forward = [...nodes];
    const backward = [...nodes].reverse();
    const rotations = (items: string[]) =>
      items.map((_, index) => [...items.slice(index), ...items.slice(0, index)].join(" -> "));
    return [...rotations(forward), ...rotations(backward)].sort()[0] ?? "";
  }

  for (const start of graph.keys()) {
    const stack: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const next of graph.get(current.node) ?? []) {
        if (next === start && current.path.length > 1) {
          cycles.add(normalizeCycle(current.path));
          continue;
        }
        if (current.path.includes(next)) continue;
        stack.push({ node: next, path: [...current.path, next] });
      }
    }
  }

  return [...cycles].map((cycle) => cycle.split(" -> "));
}

for (const config of MODULES) {
  test(`${config.name} barrel exports only the public module interface`, async () => {
    const mod = await import(config.alias);
    assert.deepEqual(Object.keys(mod).sort(), [...config.expectedExports].sort());
    for (const forbidden of config.forbiddenExports) {
      assert.equal(forbidden in mod, false, `${config.name} must not export ${forbidden}`);
    }
  });

  test(`${config.name} internals are cycle-free and do not back-import the public barrel`, () => {
    const files = walkFiles(config.dir)
      .filter((file) => relPath(file).endsWith(".ts"))
      .sort();

    const graph = new Map<string, string[]>();
    const barrelBackImports: string[] = [];

    for (const file of files) {
      const rel = relPath(file);
      const imports = parseModuleSpecifiers(readFileSync(file, "utf8"));
      if (rel !== `${config.relativeDir}/index.ts`) {
        for (const specifier of imports) {
          if ([...BARREL_SUFFIXES].some((suffix) => specifier === `${config.alias}${suffix}`)) {
            barrelBackImports.push(`${rel} -> ${specifier}`);
          }
        }
      }

      const deps: string[] = [];
      for (const specifier of imports) {
        const resolved = resolveModuleImport(file, specifier, config);
        if (resolved) deps.push(resolved);
      }
      graph.set(rel, [...new Set(deps)].sort());
    }

    assert.deepEqual(barrelBackImports, []);

    const cycles = detectCycles(graph);
    assert.deepEqual(
      cycles,
      [],
      `Detected ${config.name} import cycle(s): ${cycles.map((cycle) => cycle.join(" -> ")).join(" | ")}`,
    );
  });

  test(`src modules outside ${config.name} avoid private ${config.name} internals`, () => {
    const violations: string[] = [];
    for (const file of walkFiles(SRC_DIR)) {
      const rel = relPath(file);
      if (rel.startsWith(`${config.relativeDir}/`)) continue;
      const imports = parseModuleSpecifiers(readFileSync(file, "utf8"));
      for (const specifier of imports) {
        if (config.privateInternalImports.includes(specifier)) {
          violations.push(`${rel} -> ${specifier}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });
}
