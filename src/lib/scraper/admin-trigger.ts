/**
 * Admin provider trigger (issue #1097, Phase 2.7).
 *
 * The NORMAL admin trigger no longer synchronously discovers + scrapes URLs
 * (the legacy `discoverProviderUrls` + `scrapeAndSave` loop, which could
 * rescrape a KNOWN public Article and violate the governing invariant).
 * Instead it REQUESTS an incremental discovery run through the incremental
 * module: it validates the trigger mode + provider(s) + bounded limit, marks the
 * provider's claimable-mode discovery sources due (`nextRunAt = now`), and
 * writes an AUDIT record. Bodies are fetched later by the candidate-ingest job
 * pipeline; only identities first observed AFTER a completed baseline are ever
 * ingested.
 *
 * Only `incremental` (the default) is implemented. `backfill` / `force-rescrape`
 * are rejected EXPLICITLY (Phase 3, non-goal here); a normal trigger input can
 * neither smuggle a bypass flag (unknown keys are dropped by the object schema)
 * nor fall through to old behavior.
 *
 * PRIVACY: audit metadata records controlled machine fields only (mode, provider
 * keys, counts, phase) — never a URL or article content.
 */
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { PROVIDERS, getProvider } from "@/lib/scraper/providers";
import { requestIncrementalRun } from "@/lib/scraper/incremental/incremental-run-request";
import {
  DEFAULT_TRIGGER_MODE,
  validateTriggerMode,
  type TriggerMode,
} from "@/lib/scraper/incremental/trigger-mode";
import type { Provider } from "@/lib/scraper/types";

export const ADMIN_SCRAPE_TRIGGER_DEFAULT_LIMIT = 5;
export const ADMIN_SCRAPE_TRIGGER_MAX_LIMIT = 50;

export type AdminScrapeTriggerInput = {
  provider?: string;
  all?: boolean;
  limit?: number;
  /** Explicit trigger mode. Defaults to `incremental`; only that is implemented. */
  mode?: string;
};

/** Per-provider result: how many discovery sources this run request woke. */
export type AdminScrapeProviderResult = {
  provider: string;
  sourcesRequested: number;
};

export type AdminScrapeTriggerResult = {
  /** The validated, implemented trigger mode (currently always `incremental`). */
  mode: TriggerMode;
  results: AdminScrapeProviderResult[];
  /** Total discovery sources made due across the selected providers. */
  totalSourcesRequested: number;
};

type AdminScrapeTriggerLog = {
  warn: (event: string, meta?: Record<string, unknown>) => void;
  info: (event: string, meta?: Record<string, unknown>) => void;
};

type AdminScrapeTriggerSession = {
  user: {
    id: string;
    role?: string | null;
  };
};

export type AdminScrapeTriggerContext = {
  req: Request;
  session: AdminScrapeTriggerSession;
  requestId: string;
  log: AdminScrapeTriggerLog;
};

/** A bad provider selection (unknown key / neither provider nor all). */
export class AdminScrapeTriggerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminScrapeTriggerInputError";
  }
}

/** A defined-but-unimplemented / unknown trigger mode (fail explicitly, AC3). */
export class AdminScrapeTriggerModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminScrapeTriggerModeError";
  }
}

function clampLimit(limit: number | undefined): number {
  const value = limit ?? ADMIN_SCRAPE_TRIGGER_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ADMIN_SCRAPE_TRIGGER_MAX_LIMIT, value));
}

/**
 * Validates the request and REQUESTS an incremental discovery run for the
 * selected provider(s). Never fetches a body or writes an Article.
 */
export async function runAdminScrapeTrigger(
  input: AdminScrapeTriggerInput,
  context: AdminScrapeTriggerContext,
): Promise<AdminScrapeTriggerResult> {
  const modeResult = validateTriggerMode(input.mode ?? DEFAULT_TRIGGER_MODE);
  if (!modeResult.ok) {
    throw new AdminScrapeTriggerModeError(modeResult.message);
  }
  const mode = modeResult.mode;
  const limit = clampLimit(input.limit);
  const providers = selectProviders(input);
  const scrapeAll = input.all === true;

  const results: AdminScrapeProviderResult[] = [];
  let totalSourcesRequested = 0;
  for (const provider of providers) {
    const { requested } = await requestIncrementalRun([provider.key], new Date());
    results.push({ provider: provider.key, sourcesRequested: requested });
    totalSourcesRequested += requested;
  }

  await recordAuditFromRequest({
    req: context.req,
    session: context.session,
    requestId: context.requestId,
    action: AUDIT_ACTIONS.adminScrapeTrigger,
    targetType: "scrape",
    targetId: scrapeAll ? "all" : providers[0]?.key ?? "unknown",
    metadata: {
      mode,
      providerCount: providers.length,
      providers: providers.map((provider) => provider.key),
      limit,
      sourcesRequested: totalSourcesRequested,
      phase: "requested",
    },
  });

  context.log.info("scrape.trigger.requested", {
    mode,
    providerCount: providers.length,
    sourcesRequested: totalSourcesRequested,
  });

  return { mode, results, totalSourcesRequested };
}

function selectProviders(input: AdminScrapeTriggerInput): Provider[] {
  if (input.all === true) {
    return [...PROVIDERS];
  }

  if (input.provider) {
    const provider = getProvider(input.provider);
    if (!provider) {
      throw new AdminScrapeTriggerInputError(
        `Unknown provider: "${input.provider}". Available: ${PROVIDERS.map((p) => p.key).join(", ")}.`,
      );
    }
    return [provider];
  }

  throw new AdminScrapeTriggerInputError("Specify a `provider` key or set `all: true`.");
}
