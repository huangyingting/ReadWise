import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { prisma } from "@/lib/prisma";
import { discoverProviderUrlEntries } from "@/lib/scraper/discovery";
import { PROVIDERS, getProvider } from "@/lib/scraper/providers";
import {
  fetchPlanSummary,
  providerWorkflowConfig,
  type ProviderWorkflowConfig,
} from "@/lib/scraper/workflow";
import { requestIncrementalRun } from "@/lib/scraper/incremental/incremental-run-request";
import { DEFAULT_TRIGGER_MODE, validateTriggerMode } from "@/lib/scraper/incremental/trigger-mode";
import type { DiscoveredUrl, Provider } from "@/lib/scraper/types";
import {
  addUniqueFromCsv,
  isMain,
  parseFlag,
  parsePositiveInt,
  parseString,
  runCli,
  warnUnknown,
} from "./lib/cli";

type Command = "discover" | "scrape" | "resume" | "review" | "status" | "list";
type OutcomeStatus = "saved" | "skipped" | "duplicate" | "rejected" | "failed";
type DiscoveryOrder = "source" | "newest" | "oldest";

type Args = {
  command: Command;
  providers: string[];
  limit: number;
  all: boolean;
  includeExisting: boolean;
  retryFailed: boolean;
  since: Date | null;
  order: DiscoveryOrder;
  stopAfterExisting: number | null;
  outDir: string;
  urlsFile: string | null;
  concurrency: number | null;
  delayMs: number | null;
  sample: number | null;
  host: string;
  port: number;
  feedbackFile: string | null;
  mode: string;
  help: boolean;
};

type ProviderStatePaths = {
  dir: string;
  discovered: string;
  discoveredJsonl: string;
  pending: string;
  pendingJsonl: string;
  outcomes: string;
  progress: string;
  failed: string;
  rejected: string;
  feedback: string;
};

type ProgressSummary = {
  provider: string;
  runId: string;
  command: "scrape" | "resume";
  status: "running" | "completed" | "crashed";
  updatedAt: string;
  discovered: number;
  existingAtStart: number;
  finalizedAtStart: number;
  since?: string;
  order: DiscoveryOrder;
  stopAfterExisting?: number;
  queued: number;
  attempted: number;
  saved: number;
  skipped: number;
  duplicate: number;
  rejected: number;
  failed: number;
  retry: number;
  nextQueueIndex?: number;
  currentDbArticleCount?: number;
  error?: string;
  config: {
    concurrency: number;
    delayMs: number;
    fetchPlan: string;
  };
};

type OutcomeCounts = {
  saved: number;
  skipped: number;
  duplicate: number;
  rejected: number;
  failed: number;
  retry: number;
};

const DEFAULT_LIMIT = 100;
const DEFAULT_OUT_DIR = ".scraper-state/providers";
const SOURCE_URL_CHUNK_SIZE = 500;

export function parseArgs(argv: string[]): Args {
  const command = parseCommand(argv);
  const providers = parseProviderKeys(argv);
  const sample = parseOptionalPositiveInt(argv, "--sample");
  const args: Args = {
    command,
    providers,
    limit: parsePositiveInt(argv, "--limit", sample ?? DEFAULT_LIMIT),
    all: parseFlag(argv, "--all", "--until-exhausted"),
    includeExisting: parseFlag(argv, "--include-existing"),
    retryFailed: command === "resume" || parseFlag(argv, "--retry-failed"),
    since: parseSince(argv),
    order: parseDiscoveryOrder(argv),
    stopAfterExisting: parseOptionalPositiveInt(argv, "--stop-after-existing"),
    outDir: parseString(argv, "--out-dir") ?? DEFAULT_OUT_DIR,
    urlsFile: parseString(argv, "--urls") ?? parseString(argv, "--file"),
    concurrency: parseOptionalPositiveInt(argv, "--concurrency"),
    delayMs: parseOptionalNonNegativeInt(argv, "--delay-ms"),
    sample,
    host: parseString(argv, "--host") ?? "127.0.0.1",
    port: parsePositiveInt(argv, "--port", 4317),
    feedbackFile: parseFeedbackFile(argv),
    mode: parseString(argv, "--mode") ?? DEFAULT_TRIGGER_MODE,
    help: parseFlag(argv, "--help", "-h"),
  };

  warnUnknownFlags(argv);
  return args;
}

function parseCommand(argv: string[]): Command {
  const first = argv.find((arg) => !arg.startsWith("-"));
  if (
    first === "discover" ||
    first === "scrape" ||
    first === "resume" ||
    first === "review" ||
    first === "status" ||
    first === "list"
  ) {
    return first;
  }
  return "discover";
}

function parseProviderKeys(argv: string[]): string[] {
  const providers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg !== "--provider" && arg !== "--providers") continue;
    const value = argv[i + 1];
    if (!value) continue;
    addUniqueFromCsv(providers, value.toLowerCase());
    i += 1;
  }
  return providers;
}

function parseOptionalPositiveInt(argv: string[], flag: string): number | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  const parsed = Number(argv[idx + 1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalNonNegativeInt(argv: string[], flag: string): number | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  const parsed = Number(argv[idx + 1]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseFeedbackFile(argv: string[]): string | null {
  if (parseFlag(argv, "--feedback-none")) return null;
  const value = parseString(argv, "--feedback-file");
  if (value === "none") return null;
  return value;
}

function parseSince(argv: string[]): Date | null {
  const value = parseString(argv, "--since");
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --since date: ${value}`);
  return new Date(parsed);
}

function parseDiscoveryOrder(argv: string[]): DiscoveryOrder {
  const value = parseString(argv, "--order") ?? "source";
  if (value === "source" || value === "newest" || value === "oldest") return value;
  throw new Error(`Invalid --order: ${value}. Use source, newest, or oldest.`);
}

function warnUnknownFlags(argv: string[]): void {
  const valueFlags = new Set([
    "--provider",
    "--providers",
    "--limit",
    "--out-dir",
    "--urls",
    "--file",
    "--concurrency",
    "--delay-ms",
    "--sample",
    "--since",
    "--order",
    "--stop-after-existing",
    "--host",
    "--port",
    "--feedback-file",
    "--mode",
  ]);
  const booleanFlags = new Set([
    "--all",
    "--until-exhausted",
    "--include-existing",
    "--retry-failed",
    "--feedback-none",
    "--help",
    "-h",
  ]);
  const commands = new Set(["discover", "scrape", "resume", "review", "status", "list"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (commands.has(arg)) continue;
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (booleanFlags.has(arg)) continue;
    if (arg.startsWith("-")) warnUnknown(arg);
  }
}

function printHelp(): void {
  console.log(`Unified provider scraping workflow

Usage:
  npm run scrape:provider -- discover --provider atlasobscura --all
  npm run scrape:provider -- scrape --provider atlasobscura
  npm run scrape:provider -- resume --provider atlasobscura
  npm run scrape:provider -- review --provider atlasobscura --sample 50
  npm run scrape:provider -- status --provider atlasobscura

Commands:
  list       Show registered providers and workflow defaults.
  discover   Discover URLs, filter existing URLs, and write URL lists (inspection only; no save).
  scrape     Request an incremental discovery run through the candidate ledger (mode incremental).
  resume     Alias of scrape: re-request an incremental discovery run for the provider.
  review     Start no-DB human review using scripts/scrape-review.ts.
  status     Summarize provider progress/outcomes from state files.

Incremental model:
  scrape/resume NO LONGER synchronously fetch and save articles. They mark the
  provider's claimable discovery sources (SHADOW/BASELINE/ACTIVE) due so the
  worker discovery loop runs bounded, ledger-based discovery. Bodies are fetched
  later by the candidate-ingest pipeline. Only identities first observed AFTER a
  completed baseline are ingested; a known public Article is never rescraped.

Options:
  --mode incremental  Trigger mode. Only "incremental" (default) is implemented;
                      "backfill"/"force-rescrape" are rejected until Phase 3.
  --provider key       Provider key; repeat or comma-separate. Defaults to all for list/status, required otherwise.
  --limit N           URL count for discover/review (default ${DEFAULT_LIMIT}).
  --all               Discover all provider candidates (discover command).
  --urls <path>       Use a newline-delimited URL file instead of discovery (discover/review).
  --since <date>      Keep URLs with known dates on/after this date; undated URLs are retained.
  --order source|newest|oldest
                      Order discovered URLs by source order or metadata date.
  --stop-after-existing N
                      Stop pending selection after N consecutive already-known URLs.
  --include-existing  Do not exclude sourceUrls already present in the DB (discover).
  --out-dir <path>    State directory (default ${DEFAULT_OUT_DIR}).
  --sample N          Review sample size.
  --host/--port       Review server host/port.
  --feedback-file     Review feedback JSONL path ("none" disables writes).
`);
}

function resolveProviders(args: Args): Provider[] {
  if (args.providers.length === 0) {
    if (args.command === "list" || args.command === "status") return [...PROVIDERS];
    throw new Error("--provider is required for discover/scrape/resume/review. Use --provider all intentionally.");
  }

  if (args.providers.includes("all")) return [...PROVIDERS];

  return args.providers.map((key) => {
    const provider = getProvider(key);
    if (!provider) throw new Error(`Unknown provider: ${key}`);
    return provider;
  });
}

function workflowFor(provider: Provider, args: Args): ProviderWorkflowConfig {
  return providerWorkflowConfig(provider, {
    concurrency: args.concurrency ?? undefined,
    requestDelayMs: args.delayMs ?? undefined,
    reviewSampleSize: args.sample ?? undefined,
  });
}

function repoPath(input: string): string {
  return path.resolve(process.cwd(), input);
}

function statePaths(outDir: string, providerKey: string): ProviderStatePaths {
  const dir = path.join(repoPath(outDir), providerKey);
  return {
    dir,
    discovered: path.join(dir, "discovered-urls.txt"),
    discoveredJsonl: path.join(dir, "discovered-urls.jsonl"),
    pending: path.join(dir, "pending-urls.txt"),
    pendingJsonl: path.join(dir, "pending-urls.jsonl"),
    outcomes: path.join(dir, "outcomes.jsonl"),
    progress: path.join(dir, "progress.json"),
    failed: path.join(dir, "failed-urls.txt"),
    rejected: path.join(dir, "rejected-urls.txt"),
    feedback: path.join(dir, "feedback.jsonl"),
  };
}

async function writeUrlList(filePath: string, urls: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, urls.length > 0 ? `${urls.join("\n")}\n` : "", "utf8");
}

async function writeDiscoveredEntries(filePath: string, entries: DiscoveredUrl[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, content ? `${content}\n` : "", "utf8");
}

async function readUrlList(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readDiscoveredEntries(filePath: string): Promise<DiscoveredUrl[]> {
  const content = await readFile(filePath, "utf8");
  const entries: DiscoveredUrl[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = parseDiscoveredEntry(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

async function discoverUrls(provider: Provider, args: Args, paths: ProviderStatePaths): Promise<DiscoveredUrl[]> {
  if (args.urlsFile) {
    const entries = normalizeDiscoveryEntries(
      dedupeUrls(await readUrlList(args.urlsFile)).map((url) => ({ url, source: "file" as const })),
    );
    const ordered = applyDiscoveryFilters(entries, args);
    await writeUrlList(paths.discovered, ordered.map((entry) => entry.url));
    await writeDiscoveredEntries(paths.discoveredJsonl, ordered);
    return ordered;
  }

  const limit = args.all ? Number.POSITIVE_INFINITY : args.limit;
  const entries = applyDiscoveryFilters(
    normalizeDiscoveryEntries(await discoverProviderUrlEntries(provider, limit)),
    args,
  );
  await writeUrlList(paths.discovered, entries.map((entry) => entry.url));
  await writeDiscoveredEntries(paths.discoveredJsonl, entries);
  return entries;
}

async function urlsForResume(provider: Provider, args: Args, paths: ProviderStatePaths): Promise<DiscoveredUrl[]> {
  if (args.urlsFile) {
    return applyDiscoveryFilters(
      normalizeDiscoveryEntries(dedupeUrls(await readUrlList(args.urlsFile)).map((url) => ({ url, source: "file" as const }))),
      args,
    );
  }
  try {
    return applyDiscoveryFilters(normalizeDiscoveryEntries(await readDiscoveredEntries(paths.discoveredJsonl)), args);
  } catch (err) {
    if (!isFileNotFound(err)) throw err;
  }
  try {
    return applyDiscoveryFilters(
      normalizeDiscoveryEntries(dedupeUrls(await readUrlList(paths.discovered)).map((url) => ({ url }))),
      args,
    );
  } catch (err) {
    if (isFileNotFound(err)) return discoverUrls(provider, args, paths);
    throw err;
  }
}

async function existingSourceUrls(urls: string[]): Promise<Set<string>> {
  const unique = [...new Set(urls)];
  const existing = new Set<string>();
  for (let i = 0; i < unique.length; i += SOURCE_URL_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + SOURCE_URL_CHUNK_SIZE);
    const articles = await prisma.article.findMany({
      where: { ownerId: null, sourceUrl: { in: chunk } },
      select: { sourceUrl: true },
    });
    for (const article of articles) {
      if (article.sourceUrl) existing.add(article.sourceUrl);
    }
  }
  return existing;
}

export function selectPendingUrls(
  urls: string[],
  existing: Set<string>,
  finalized: Map<string, OutcomeStatus>,
  args: Pick<Args, "includeExisting" | "all" | "limit" | "retryFailed"> & { stopAfterExisting?: number | null },
): string[] {
  return selectPendingEntries(
    urls.map((url) => normalizeDiscoveryEntry({ url })),
    existing,
    finalized,
    args,
  ).map((entry) => entry.url);
}

export function selectPendingEntries(
  entries: DiscoveredUrl[],
  existing: Set<string>,
  finalized: Map<string, OutcomeStatus>,
  args: Pick<Args, "includeExisting" | "all" | "limit" | "retryFailed"> & { stopAfterExisting?: number | null },
): DiscoveredUrl[] {
  const pending: DiscoveredUrl[] = [];
  let consecutiveKnown = 0;

  for (const entry of entries) {
    const known = !args.includeExisting && existing.has(entry.url);
    const status = finalized.get(entry.url);
    const retryableFailure = status === "failed" && args.retryFailed;

    if (known || (status && !retryableFailure)) {
      consecutiveKnown += 1;
      if (args.stopAfterExisting != null && consecutiveKnown >= args.stopAfterExisting) break;
      continue;
    }

    consecutiveKnown = 0;
    if (!status || retryableFailure) pending.push(entry);
    if (!args.all && pending.length >= args.limit) break;
  }

  return pending;
}

export function applyDiscoveryFilters(
  entries: DiscoveredUrl[],
  args: Pick<Args, "since" | "order">,
): DiscoveredUrl[] {
  const filtered = args.since
    ? entries.filter((entry) => {
        const time = discoveryEntryTime(entry);
        return time == null || time >= args.since!.getTime();
      })
    : entries;
  if (args.order === "source") return filtered;
  const direction = args.order === "newest" ? -1 : 1;
  return filtered
    .map((entry, index) => ({ entry, index, time: discoveryEntryTime(entry) }))
    .sort((a, b) => {
      if (a.time == null && b.time == null) return a.index - b.index;
      if (a.time == null) return 1;
      if (b.time == null) return -1;
      return (a.time - b.time) * direction || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

function normalizeDiscoveryEntries(entries: Array<Partial<DiscoveredUrl> & { url: string }>): DiscoveredUrl[] {
  const seen = new Set<string>();
  const normalized: DiscoveredUrl[] = [];
  for (const entry of entries) {
    const next = normalizeDiscoveryEntry(entry);
    if (seen.has(next.url)) continue;
    seen.add(next.url);
    normalized.push(next);
  }
  return normalized;
}

function normalizeDiscoveryEntry(entry: Partial<DiscoveredUrl> & { url: string }): DiscoveredUrl {
  const publishedAt = normalizeDate(entry.publishedAt) ?? inferPublishedAtFromUrl(entry.url);
  const lastModified = normalizeDate(entry.lastModified);
  return {
    url: entry.url,
    source: entry.source ?? "unknown",
    discoveredAt: normalizeDate(entry.discoveredAt) ?? new Date().toISOString(),
    ...(publishedAt ? { publishedAt } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
  };
}

function parseDiscoveredEntry(line: string): DiscoveredUrl | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const entry = parsed as Partial<DiscoveredUrl>;
  return typeof entry.url === "string" ? normalizeDiscoveryEntry({ ...entry, url: entry.url }) : null;
}

function discoveryEntryTime(entry: Pick<DiscoveredUrl, "publishedAt" | "lastModified">): number | null {
  const value = entry.publishedAt ?? entry.lastModified;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function inferPublishedAtFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\/(20\d{2})\/([01]\d)\/([0-3]\d)(?:\/|$)/)
    ?? pathname.match(/\/(20\d{2})-([01]\d)-([0-3]\d)(?:[-/]|$)/);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

async function readFinalizedOutcomes(filePath: string): Promise<Map<string, OutcomeStatus>> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    if (isFileNotFound(err)) return new Map();
    throw err;
  }

  const finalized = new Map<string, OutcomeStatus>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = parseOutcomeRecord(line);
    if (record) finalized.set(record.url, record.status);
  }
  return finalized;
}

function parseOutcomeRecord(line: string): { url: string; status: OutcomeStatus } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { type?: unknown; url?: unknown; status?: unknown };
  if (record.type !== "outcome" || typeof record.url !== "string") return null;
  if (!isOutcomeStatus(record.status)) return null;
  return { url: record.url, status: record.status };
}

function isOutcomeStatus(value: unknown): value is OutcomeStatus {
  return (
    value === "saved" ||
    value === "skipped" ||
    value === "duplicate" ||
    value === "rejected" ||
    value === "failed"
  );
}

export function countFinalizedOutcomes(finalized: Map<string, OutcomeStatus>): OutcomeCounts {
  const counts: OutcomeCounts = { saved: 0, skipped: 0, duplicate: 0, rejected: 0, failed: 0, retry: 0 };
  for (const status of finalized.values()) {
    counts[status] += 1;
  }
  return counts;
}

async function runDiscover(provider: Provider, args: Args): Promise<void> {
  const paths = statePaths(args.outDir, provider.key);
  await mkdir(paths.dir, { recursive: true });
  const entries = await discoverUrls(provider, args, paths);
  const urls = entries.map((entry) => entry.url);
  const existing = args.includeExisting ? new Set<string>() : await existingSourceUrls(urls);
  const finalized = await readFinalizedOutcomes(paths.outcomes);
  const pending = selectPendingEntries(entries, existing, finalized, args);
  await writeUrlList(paths.pending, pending.map((entry) => entry.url));
  await writeDiscoveredEntries(paths.pendingJsonl, pending);
  console.log(
    `${provider.key}: discovered ${entries.length}; pending ${pending.length}; existing ${existing.size}; finalized ${finalized.size}`,
  );
  console.log(`State: ${path.relative(process.cwd(), paths.dir)}`);
}

async function runIncrementalRequest(provider: Provider, args: Args): Promise<void> {
  const validated = validateTriggerMode(args.mode);
  if (!validated.ok) {
    throw new Error(
      validated.reason === "not-implemented"
        ? `Mode "${args.mode}" is not implemented yet (deferred to Phase 3). Only "incremental" is supported.`
        : `Unknown mode "${args.mode}". Only "incremental" is supported.`,
    );
  }

  const { requested } = await requestIncrementalRun([provider.key], new Date());
  console.log(
    `${provider.key}: requested incremental discovery run (mode ${validated.mode}); sources woken ${requested}`,
  );
  if (requested === 0) {
    console.log(
      `${provider.key}: no claimable discovery source (SHADOW/BASELINE/ACTIVE). Register/activate a source first.`,
    );
  }
  console.log(
    "Discovery + ingest run asynchronously via the worker loop and the candidate-ingest pipeline; no article is fetched or saved by this command.",
  );
}

async function runStatus(provider: Provider, args: Args): Promise<void> {
  const paths = statePaths(args.outDir, provider.key);
  let progress: ProgressSummary | null = null;
  try {
    progress = JSON.parse(await readFile(paths.progress, "utf8")) as ProgressSummary;
  } catch (err) {
    if (!isFileNotFound(err)) throw err;
  }
  const outcomes = await readFinalizedOutcomes(paths.outcomes);
  const counts = countFinalizedOutcomes(outcomes);
  console.log(`\n== ${provider.name} (${provider.key}) ==`);
  if (!progress) {
    console.log("No progress file yet.");
    return;
  }
  const processed = counts.saved + counts.rejected + counts.failed + counts.duplicate + counts.skipped;
  const remaining = Math.max(0, progress.discovered - progress.existingAtStart - processed);
  console.log(`status=${progress.status} updated=${progress.updatedAt}`);
  console.log(`discovered=${progress.discovered} queued=${progress.queued} remaining~=${remaining}`);
  console.log(
    `saved=${counts.saved} rejected=${counts.rejected} failed=${counts.failed} duplicate=${counts.duplicate} skipped=${counts.skipped}`,
  );
  console.log(`config=${JSON.stringify(progress.config)}`);
}

async function runReview(
  provider: Provider,
  args: Args,
  spawnNpmImpl: (args: string[]) => Promise<void> = spawnNpm,
): Promise<void> {
  const workflow = workflowFor(provider, args);
  const paths = statePaths(args.outDir, provider.key);
  const sample = args.sample ?? workflow.reviewSampleSize;
  const feedbackFile = args.feedbackFile ?? paths.feedback;
  const reviewArgs = [
    "run",
    "scrape-review",
    "--",
    "--no-db",
    "--provider",
    provider.key,
    "--limit",
    String(sample),
    "--host",
    args.host,
    "--port",
    String(args.port),
    "--feedback-file",
    feedbackFile,
  ];
  if (args.urlsFile) {
    reviewArgs.push("--urls", args.urlsFile);
  } else {
    reviewArgs.push("--discover");
  }
  console.log(`Starting review server for ${provider.key}; feedback: ${feedbackFile}`);
  await spawnNpmImpl(reviewArgs);
}

function spawnNpm(args: string[], spawnImpl: typeof spawn = spawn): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("npm", args, { stdio: "inherit", cwd: process.cwd() });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function listProviders(args: Args): void {
  for (const provider of resolveProviders(args)) {
    const workflow = workflowFor(provider, args);
    console.log(
      `${provider.key}\t${provider.name}\tconcurrency=${workflow.concurrency}\tdelayMs=${workflow.requestDelayMs}\t${fetchPlanSummary(workflow)}`,
    );
  }
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const normalized = normalizeUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeUrl(raw: string): string | null {
  try {
    return new URL(raw).href.split("#")[0] ?? raw;
  } catch {
    return null;
  }
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const providers = resolveProviders(args);
  if (args.command === "list") {
    listProviders(args);
    return 0;
  }

  for (const provider of providers) {
    if (args.command === "discover") await runDiscover(provider, args);
    if (args.command === "scrape" || args.command === "resume") await runIncrementalRequest(provider, args);
    if (args.command === "review") await runReview(provider, args);
    if (args.command === "status") await runStatus(provider, args);
  }
  return 0;
}

export const __scrapeProviderTest = {
  printHelp,
  resolveProviders,
  workflowFor,
  repoPath,
  statePaths,
  writeUrlList,
  writeDiscoveredEntries,
  readUrlList,
  readDiscoveredEntries,
  discoverUrls,
  urlsForResume,
  existingSourceUrls,
  normalizeDiscoveryEntries,
  normalizeDiscoveryEntry,
  parseDiscoveredEntry,
  discoveryEntryTime,
  normalizeDate,
  inferPublishedAtFromUrl,
  readFinalizedOutcomes,
  parseOutcomeRecord,
  runDiscover,
  runIncrementalRequest,
  runStatus,
  runReview,
  spawnNpm,
  listProviders,
  dedupeUrls,
  normalizeUrl,
  isFileNotFound,
  main,
};

if (isMain(import.meta.url)) {
  runCli(main);
}
