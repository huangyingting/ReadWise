/**
 * Push reminder preferences (RW-045).
 *
 * Per-user control over reminder timing + quiet hours. Pure helpers
 * (`validateReminderPreference`, `isWithinQuietHours`, `shouldSendNow`,
 * `localHourInTimeZone`) are unit-testable with no I/O; the `get*`/`upsert*`
 * accessors touch Prisma. Server-only — never import from a Client Component.
 */
import { prisma } from "@/lib/prisma";

export const MIN_HOUR = 0;
export const MAX_HOUR = 23;

/** A user's effective reminder preferences (defaults applied). */
export interface ReminderPreference {
  enabled: boolean;
  /** 0–23 local hour to send the daily reminder, or null for "any hour". */
  preferredHour: number | null;
  /** 0–23 inclusive start of the quiet window, or null when unset. */
  quietHoursStart: number | null;
  /** 0–23 exclusive end of the quiet window, or null when unset. */
  quietHoursEnd: number | null;
  /** IANA timezone; falls back to Profile.timezone then UTC. */
  timezone: string | null;
}

/** The default preference when a user has never configured one (opt-out model). */
export const DEFAULT_REMINDER_PREFERENCE: ReminderPreference = {
  enabled: true,
  preferredHour: null,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: null,
};

// ---------------------------------------------------------------------------
// Pure validation + scheduling logic
// ---------------------------------------------------------------------------

type PartialPrefInput = {
  enabled?: unknown;
  preferredHour?: unknown;
  quietHoursStart?: unknown;
  quietHoursEnd?: unknown;
  timezone?: unknown;
};

function parseHour(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isInteger(num)) return undefined;
  if (num < MIN_HOUR || num > MAX_HOUR) return undefined;
  return num;
}

export type ReminderPreferenceUpdate = {
  enabled?: boolean;
  preferredHour?: number | null;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  timezone?: string | null;
};

/**
 * Validate a partial preference update from an untrusted client. Hours must be
 * integers in [0, 23] or null; quiet hours must be supplied together (both or
 * neither). Returns the normalized update or a human-readable error.
 */
export function validateReminderPreference(
  input: PartialPrefInput,
):
  | { ok: true; value: ReminderPreferenceUpdate }
  | { ok: false; error: string } {
  const value: ReminderPreferenceUpdate = {};

  if ("enabled" in input && input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean" };
    }
    value.enabled = input.enabled;
  }

  if ("preferredHour" in input) {
    const hour = parseHour(input.preferredHour);
    if (hour === undefined) {
      return { ok: false, error: "preferredHour must be an integer 0–23 or null" };
    }
    value.preferredHour = hour;
  }

  let qStart: number | null | undefined;
  let qEnd: number | null | undefined;
  if ("quietHoursStart" in input) {
    qStart = parseHour(input.quietHoursStart);
    if (qStart === undefined) {
      return { ok: false, error: "quietHoursStart must be an integer 0–23 or null" };
    }
    value.quietHoursStart = qStart;
  }
  if ("quietHoursEnd" in input) {
    qEnd = parseHour(input.quietHoursEnd);
    if (qEnd === undefined) {
      return { ok: false, error: "quietHoursEnd must be an integer 0–23 or null" };
    }
    value.quietHoursEnd = qEnd;
  }
  // Quiet hours are a window: both ends must be present together.
  const startProvided = "quietHoursStart" in input && value.quietHoursStart != null;
  const endProvided = "quietHoursEnd" in input && value.quietHoursEnd != null;
  if (startProvided !== endProvided) {
    return {
      ok: false,
      error: "quietHoursStart and quietHoursEnd must be set together",
    };
  }

  if ("timezone" in input && input.timezone !== undefined) {
    if (input.timezone === null) {
      value.timezone = null;
    } else if (typeof input.timezone === "string" && input.timezone.length <= 64) {
      value.timezone = input.timezone.trim() || null;
    } else {
      return { ok: false, error: "timezone must be a string (<=64 chars) or null" };
    }
  }

  return { ok: true, value };
}

/**
 * Whether `hour` (0–23) falls inside the quiet window [start, end). Handles a
 * window that wraps past midnight (e.g. 22 → 7). Returns false when either end
 * is unset or the window is empty (start === end).
 */
export function isWithinQuietHours(
  hour: number,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  if (start == null || end == null) return false;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  // Wraps midnight.
  return hour >= start || hour < end;
}

export interface SendDecision {
  send: boolean;
  reason: "ok" | "disabled" | "quiet-hours" | "not-preferred-hour";
}

/**
 * Decide whether a reminder should be sent right now for a user, given their
 * preferences and the current local hour. Quiet hours and the disabled flag
 * suppress sends; a set `preferredHour` restricts sends to that single hour.
 */
export function shouldSendNow(
  pref: ReminderPreference,
  localHour: number,
): SendDecision {
  if (!pref.enabled) return { send: false, reason: "disabled" };
  if (isWithinQuietHours(localHour, pref.quietHoursStart, pref.quietHoursEnd)) {
    return { send: false, reason: "quiet-hours" };
  }
  if (pref.preferredHour != null && localHour !== pref.preferredHour) {
    return { send: false, reason: "not-preferred-hour" };
  }
  return { send: true, reason: "ok" };
}

/**
 * The local hour (0–23) for `date` in `timezone`. Falls back to UTC when the
 * timezone is missing or invalid (never throws).
 */
export function localHourInTimeZone(date: Date, timezone?: string | null): number {
  if (!timezone) return date.getUTCHours();
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(date);
    const hour = Number.parseInt(formatted, 10);
    if (Number.isFinite(hour)) return hour === 24 ? 0 : hour;
    return date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

// ---------------------------------------------------------------------------
// Prisma accessors
// ---------------------------------------------------------------------------

/** Read a user's stored preference, applying defaults when none exists. */
export async function getReminderPreference(
  userId: string,
): Promise<ReminderPreference> {
  const row = await prisma.reminderPreference.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_REMINDER_PREFERENCE };
  return {
    enabled: row.enabled,
    preferredHour: row.preferredHour,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
  };
}

/** Batch-read preferences for many users, keyed by userId (defaults omitted). */
export async function getReminderPreferenceMap(
  userIds: string[],
): Promise<Map<string, ReminderPreference>> {
  const map = new Map<string, ReminderPreference>();
  if (userIds.length === 0) return map;
  const rows = await prisma.reminderPreference.findMany({
    where: { userId: { in: userIds } },
  });
  for (const row of rows) {
    map.set(row.userId, {
      enabled: row.enabled,
      preferredHour: row.preferredHour,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      timezone: row.timezone,
    });
  }
  return map;
}

/** Create or update a user's reminder preference with a validated patch. */
export async function upsertReminderPreference(
  userId: string,
  update: ReminderPreferenceUpdate,
): Promise<ReminderPreference> {
  const row = await prisma.reminderPreference.upsert({
    where: { userId },
    create: { userId, ...update },
    update,
  });
  return {
    enabled: row.enabled,
    preferredHour: row.preferredHour,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
  };
}
