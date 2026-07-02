import { revalidateArticlesCache } from "@/lib/cache";
import { AUDIT_ACTIONS, recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
import { clientIp } from "@/lib/security/client-ip";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security/events";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { PROVIDERS, getProvider } from "@/lib/scraper/providers";
import { saveDraftArticle, scrapeUrl } from "@/lib/scraper";
import type { Provider } from "@/lib/scraper/types";

const ADMIN_SCRAPE_TRIGGER_ROUTE = "/api/admin/scrape/trigger";

export const ADMIN_SCRAPE_TRIGGER_DEFAULT_LIMIT = 5;
export const ADMIN_SCRAPE_TRIGGER_MAX_LIMIT = 50;

export type AdminScrapeTriggerInput = {
  provider?: string;
  all?: boolean;
  limit?: number;
};

export type AdminScrapeProviderResult = {
  provider: string;
  discovered: number;
  saved: number;
  skipped: number;
  failed: number;
  error?: string;
};

export type AdminScrapeTriggerResult = {
  results: AdminScrapeProviderResult[];
  totalSaved: number;
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

export class AdminScrapeTriggerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminScrapeTriggerInputError";
  }
}

export async function runAdminScrapeTrigger(
  input: AdminScrapeTriggerInput,
  context: AdminScrapeTriggerContext,
): Promise<AdminScrapeTriggerResult> {
  const limit = input.limit ?? ADMIN_SCRAPE_TRIGGER_DEFAULT_LIMIT;
  const scrapeAll = input.all === true;
  const providers = selectProviders(input);

  await recordAuditFromRequest({
    req: context.req,
    session: context.session,
    requestId: context.requestId,
    action: AUDIT_ACTIONS.adminScrapeTrigger,
    targetType: "scrape",
    targetId: scrapeAll ? "all" : providers[0]?.key ?? "unknown",
    metadata: {
      providerCount: providers.length,
      providers: providers.map((provider) => provider.key),
      limit,
      phase: "requested",
    },
  });

  const results: AdminScrapeProviderResult[] = [];

  for (const provider of providers) {
    let urls: string[] = [];
    try {
      urls = await discoverProviderUrls(provider, limit);
    } catch (err) {
      const message = errorMessage(err);
      context.log.warn("scrape.trigger.discover_failed", { provider: provider.key, error: message });
      recordImportFailure(context, provider.key, "discover", message);
      results.push({ provider: provider.key, discovered: 0, saved: 0, skipped: 0, failed: 0, error: message });
      continue;
    }

    let saved = 0;
    let skipped = 0;
    let failed = 0;

    for (const url of urls) {
      try {
        const article = await scrapeUrl(url);
        const outcome = article
          ? await saveDraftArticle(article, (created) => articleIngestAudit(context, provider.key, created))
          : { status: "failed" as const, reason: "could not extract article content", sourceUrl: url };

        if (outcome.status === "saved") saved++;
        else if (outcome.status === "skipped") skipped++;
        else failed++;
      } catch (err) {
        const message = errorMessage(err);
        context.log.warn("scrape.trigger.save_failed", { provider: provider.key, url, error: message });
        recordImportFailure(context, provider.key, "save", message);
        failed++;
      }
    }

    context.log.info("scrape.trigger.provider_done", {
      provider: provider.key,
      discovered: urls.length,
      saved,
      skipped,
      failed,
    });
    results.push({ provider: provider.key, discovered: urls.length, saved, skipped, failed });
  }

  const totalSaved = results.reduce((sum, result) => sum + result.saved, 0);
  if (totalSaved > 0) {
    revalidateArticlesCache();
  }

  return { results, totalSaved };
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

function articleIngestAudit(
  context: AdminScrapeTriggerContext,
  provider: string,
  created: { id: string },
): AuditRequestInput {
  return {
    req: context.req,
    session: context.session,
    requestId: context.requestId,
    action: AUDIT_ACTIONS.adminArticleIngest,
    targetType: "article",
    targetId: created.id,
    metadata: { source: "scrape.trigger", provider },
  };
}

function recordImportFailure(
  context: AdminScrapeTriggerContext,
  provider: string,
  phase: "discover" | "save",
  error: string,
): void {
  recordSecurityEvent({
    type: SECURITY_EVENT_TYPES.importFailed,
    severity: "medium",
    route: ADMIN_SCRAPE_TRIGGER_ROUTE,
    actorId: context.session.user.id,
    ip: clientIp(context.req),
    meta: { provider, phase, error },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
