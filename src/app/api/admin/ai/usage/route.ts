import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt } from "@/lib/validation";
import { summarizeAiUsage } from "@/lib/ai/usage-summary";
import { getAiBudgetStatus } from "@/lib/ai";

const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_LOOKBACK_HOURS = 168;
const MS_PER_HOUR = 3_600_000;

function usageQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      hours: queryInt(params, "hours", {
        fallback: DEFAULT_LOOKBACK_HOURS,
        min: 1,
        max: MAX_LOOKBACK_HOURS,
      }),
    },
  };
}

function lookbackStart(hours: number) {
  return new Date(Date.now() - hours * MS_PER_HOUR);
}

/**
 * GET /api/admin/ai/usage (RW-022) — admin reporting of AI usage vs configured
 * budgets/quotas. Returns the current-window budget status (per-feature/global
 * usage + limits) plus a ledger usage summary over an optional `?hours=` lookback
 * (default 24h, max 1 week) for richer context.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.analyticsView,
  {
    query: usageQuery,
  },
  async ({ query }) => {
    const since = lookbackStart(query.hours);
    const [budget, usage] = await Promise.all([
      getAiBudgetStatus(),
      summarizeAiUsage({ since }),
    ]);
    return NextResponse.json({ budget, usage, usageSinceHours: query.hours });
  },
);
