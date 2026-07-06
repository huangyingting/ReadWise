import type { Provider } from "@/lib/scraper/types";

export type FetchStrategyId =
  | "http"
  | "profile-http"
  | "playwright"
  | "reader-proxy"
  | "wayback";

export type FetchStrategyConfig = {
  strategy: FetchStrategyId;
  enabled: boolean;
  fallbackOnly?: boolean;
};

export type ProviderWorkflowConfig = {
  providerKey: string;
  fetchPlan: FetchStrategyConfig[];
  concurrency: number;
  requestDelayMs: number;
  reviewSampleSize: number;
};

export type ProviderWorkflowOverrides = Partial<
  Pick<ProviderWorkflowConfig, "concurrency" | "requestDelayMs" | "reviewSampleSize">
>;

const DEFAULT_FETCH_PLAN: FetchStrategyConfig[] = [
  { strategy: "http", enabled: true },
  { strategy: "profile-http", enabled: true, fallbackOnly: true },
  { strategy: "playwright", enabled: true, fallbackOnly: true },
  { strategy: "reader-proxy", enabled: true, fallbackOnly: true },
  { strategy: "wayback", enabled: true, fallbackOnly: true },
];

const DEFAULT_WORKFLOW: Omit<ProviderWorkflowConfig, "providerKey"> = {
  fetchPlan: DEFAULT_FETCH_PLAN,
  concurrency: 2,
  requestDelayMs: 1_000,
  reviewSampleSize: 50,
};

const ATLAS_WORKFLOW: Omit<ProviderWorkflowConfig, "providerKey"> = {
  fetchPlan: [
    { strategy: "http", enabled: true },
    { strategy: "profile-http", enabled: false, fallbackOnly: true },
    { strategy: "playwright", enabled: true, fallbackOnly: true },
    { strategy: "reader-proxy", enabled: true, fallbackOnly: true },
    { strategy: "wayback", enabled: true, fallbackOnly: true },
  ],
  concurrency: 5,
  requestDelayMs: 500,
  reviewSampleSize: 50,
};

const HAKAI_WORKFLOW: Omit<ProviderWorkflowConfig, "providerKey"> = {
  ...DEFAULT_WORKFLOW,
  fetchPlan: [
    { strategy: "http", enabled: true },
    { strategy: "profile-http", enabled: false, fallbackOnly: true },
    { strategy: "playwright", enabled: true, fallbackOnly: true },
    { strategy: "reader-proxy", enabled: true, fallbackOnly: true },
    { strategy: "wayback", enabled: true, fallbackOnly: true },
  ],
};

const PROVIDER_OVERRIDES: Record<string, Omit<ProviderWorkflowConfig, "providerKey">> = {
  atlasobscura: ATLAS_WORKFLOW,
  hakaimagazine: HAKAI_WORKFLOW,
};

export function providerWorkflowConfig(
  provider: Pick<Provider, "key">,
  overrides: ProviderWorkflowOverrides = {},
): ProviderWorkflowConfig {
  const base = PROVIDER_OVERRIDES[provider.key] ?? DEFAULT_WORKFLOW;
  return {
    providerKey: provider.key,
    fetchPlan: base.fetchPlan.map((strategy) => ({ ...strategy })),
    concurrency: overrides.concurrency ?? base.concurrency,
    requestDelayMs: overrides.requestDelayMs ?? base.requestDelayMs,
    reviewSampleSize: overrides.reviewSampleSize ?? base.reviewSampleSize,
  };
}

export function applyFetchStrategyEnvironment(config: Pick<ProviderWorkflowConfig, "fetchPlan">): void {
  const enabled = new Map(config.fetchPlan.map((strategy) => [strategy.strategy, strategy.enabled]));
  process.env.SCRAPER_FETCH_PROFILE_RETRY = envBool(enabled.get("profile-http") ?? true);
  process.env.SCRAPER_FETCH_BROWSER = envBool(enabled.get("playwright") ?? true);
  process.env.SCRAPER_FETCH_READER = envBool(enabled.get("reader-proxy") ?? true);
  process.env.SCRAPER_FETCH_WAYBACK = envBool(enabled.get("wayback") ?? true);
}

export function fetchPlanSummary(config: Pick<ProviderWorkflowConfig, "fetchPlan">): string {
  return config.fetchPlan
    .map((strategy) => {
      const suffix = strategy.fallbackOnly ? " fallback" : "";
      return `${strategy.strategy}:${strategy.enabled ? "on" : "off"}${suffix}`;
    })
    .join(", ");
}

function envBool(value: boolean): string {
  return value ? "true" : "false";
}
