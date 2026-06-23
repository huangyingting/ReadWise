import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { queryInt } from "@/lib/validation";
import { summarizeAiUsage } from "@/lib/ai-ledger";
import { getAiBudgetStatus } from "@/lib/ai-budget";

/**
 * GET /api/admin/ai/usage (RW-022) — admin reporting of AI usage vs configured
 * budgets/quotas. Returns the current-window budget status (per-feature/global
 * usage + limits) plus a ledger usage summary over an optional `?hours=` lookback
 * (default 24h, max 1 week) for richer context.
 */
export const GET = createAdminHandler(
  {
    query: (params) => ({
      ok: true as const,
      value: { hours: queryInt(params, "hours", { fallback: 24, min: 1, max: 168 }) },
    }),
  },
  async ({ query }) => {
    const since = new Date(Date.now() - query.hours * 3_600_000);
    const [budget, usage] = await Promise.all([
      getAiBudgetStatus(),
      summarizeAiUsage({ since }),
    ]);
    return NextResponse.json({ budget, usage, usageSinceHours: query.hours });
  },
);
