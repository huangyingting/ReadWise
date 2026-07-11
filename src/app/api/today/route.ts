import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import type { ValidationResult } from "@/lib/validation";
import { queryString } from "@/lib/validation";
import { loadTodayViewModel } from "@/lib/engagement/today-session";
import {
  defineFeatureGate,
  enforceFeatureGate,
} from "@/lib/runtime-config/feature-flags";

/**
 * GET /api/today
 *
 * Returns the authenticated learner's privacy-safe Today view model for their
 * local day (session status, primary article display, readable backups, the
 * reading → comprehension → word-review step tracker, completion tier/progress,
 * skip + no-candidate states). All article ids are resolved to access-checked
 * display cards by {@link loadTodayViewModel}; the payload carries anchors, ids,
 * statuses, and safe display metadata ONLY — never article/word content.
 *
 * The session is always scoped to the authenticated user; an optional
 * `?timezone=` query param anchors the correct local day, otherwise the saved
 * profile timezone (then UTC) is used. 404s when the feature is disabled.
 */
type TodayQuery = { timezone: string };

const MAX_TIMEZONE_LENGTH = 100;
const TODAY_ROUTE_FEATURE_GATE = defineFeatureGate<null, Response>({
  feature: "todaySession",
  whenDisabled: () => NextResponse.json({ error: "Not found" }, { status: 404 }),
});

function parseTodayQuery(params: URLSearchParams): ValidationResult<TodayQuery> {
  const timezone = queryString(params, "timezone");
  if (timezone.length > MAX_TIMEZONE_LENGTH) {
    return { ok: false, error: `timezone must be at most ${MAX_TIMEZONE_LENGTH} characters` };
  }
  return { ok: true, value: { timezone } };
}

function toRequestTimezone(timezone: string): string | null {
  return timezone || null;
}

export const GET = createHandler(
  { query: parseTodayQuery },
  async ({ query, session }) => {
    const disabledResponse = enforceFeatureGate(TODAY_ROUTE_FEATURE_GATE, null);
    if (disabledResponse) return disabledResponse;

    const view = await loadTodayViewModel({
      user: { id: session.user.id, role: session.user.role },
      requestTimezone: toRequestTimezone(query.timezone),
    });

    return NextResponse.json(view);
  },
);
