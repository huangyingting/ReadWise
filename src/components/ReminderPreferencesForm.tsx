"use client";

/**
 * ReminderPreferencesForm (RW-045)
 *
 * Lets a user tune WHEN review reminders are sent: an overall on/off, a
 * preferred local hour, and a quiet-hours window. Persists to
 * `PUT /api/push/preferences`; the user's timezone is auto-detected and sent so
 * the server can apply quiet hours / preferred hour in local time.
 *
 * Shown beneath {@link PushReminderToggle} in the Settings → Notifications card.
 */

import { useCallback, useEffect, useState } from "react";
import { getJson, putJson } from "@/lib/client-fetch";
import { Switch } from "@/components/ui/Switch";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { FormActions } from "@/components/ui/FormActions";
import { SkeletonText } from "@/components/ui/Skeleton";

interface Preference {
  enabled: boolean;
  preferredHour: number | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}

type PreferenceLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preference: Preference };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DEFAULT_QUIET_HOURS = {
  start: 22,
  end: 7,
} as const;

function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${ampm}`;
}

function detectTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function HourOptions() {
  return HOURS.map((h) => (
    <option key={h} value={h}>
      {hourLabel(h)}
    </option>
  ));
}

function parseOptionalHour(value: string): number | null {
  return value === "" ? null : Number(value);
}

function quietHoursPatch(enabled: boolean): Pick<Preference, "quietHoursStart" | "quietHoursEnd"> {
  return enabled
    ? { quietHoursStart: DEFAULT_QUIET_HOURS.start, quietHoursEnd: DEFAULT_QUIET_HOURS.end }
    : { quietHoursStart: null, quietHoursEnd: null };
}

function buildPreferencePayload(pref: Preference) {
  return {
    enabled: pref.enabled,
    preferredHour: pref.preferredHour,
    // Quiet hours must be sent together (or both cleared).
    quietHoursStart: pref.quietHoursStart,
    quietHoursEnd: pref.quietHoursEnd,
    timezone: detectTimezone(),
  };
}

export default function ReminderPreferencesForm() {
  const [loadState, setLoadState] = useState<PreferenceLoadState>({
    status: "loading",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const loadPreferences = useCallback(async (isCancelled: () => boolean) => {
    setLoadState({ status: "loading" });
    try {
      const data = await getJson<{ preference: Preference }>("/api/push/preferences");
      if (!isCancelled()) {
        setLoadState({ status: "ready", preference: data.preference });
      }
    } catch {
      if (!isCancelled()) {
        setLoadState({
          status: "error",
          message: "Couldn't load reminder preferences.",
        });
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPreferences(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadPreferences]);

  function update(patch: Partial<Preference>) {
    setLoadState((prev) =>
      prev.status === "ready"
        ? { status: "ready", preference: { ...prev.preference, ...patch } }
        : prev,
    );
    setStatus("idle");
  }

  async function save() {
    if (loadState.status !== "ready") return;
    const pref = loadState.preference;
    setSaving(true);
    setStatus("idle");
    try {
      const data = await putJson<{ preference: Preference }>(
        "/api/push/preferences",
        buildPreferencePayload(pref),
      );
      setLoadState({ status: "ready", preference: data.preference });
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  function retryLoad() {
    void loadPreferences(() => false);
  }

  if (loadState.status === "loading") {
    return <SkeletonText lines={2} className="w-full" />;
  }
  if (loadState.status === "error") {
    return (
      <div className="mt-[var(--space-4)] border-t border-border pt-[var(--space-4)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]" role="alert">
          <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
            {loadState.message}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const pref = loadState.preference;

  // Quiet hours are a paired window — toggling on seeds sensible defaults.
  const quietEnabled = pref.quietHoursStart != null && pref.quietHoursEnd != null;

  return (
    <div className="flex flex-col gap-[var(--space-4)] mt-[var(--space-4)] pt-[var(--space-4)] border-t border-border">
      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <div>
          <div className="font-medium text-text text-[length:var(--text-sm)]">
            Send review reminders
          </div>
          <div className="mt-[calc(var(--space-1)/2)] text-text-muted text-[length:var(--text-xs)]">
            Turn all reminder pushes on or off for your account.
          </div>
        </div>
        <Switch
          checked={pref.enabled}
          onCheckedChange={(v) => update({ enabled: v })}
          aria-label="Send review reminders"
          className="shrink-0"
        />
      </div>

      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <label
          htmlFor="reminder-preferred-hour"
          className="font-medium text-text text-[length:var(--text-sm)]"
        >
          Preferred time
        </label>
        <div className="w-40">
          <Select
            id="reminder-preferred-hour"
            selectSize="sm"
            value={pref.preferredHour ?? ""}
            onChange={(e) =>
              update({
                preferredHour: parseOptionalHour(e.target.value),
              })
            }
            disabled={!pref.enabled}
          >
            <option value="">Any time</option>
            <HourOptions />
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <div>
          <div className="font-medium text-text text-[length:var(--text-sm)]">
            Quiet hours
          </div>
          <div className="mt-[calc(var(--space-1)/2)] text-text-muted text-[length:var(--text-xs)]">
            Suppress reminders during this window.
          </div>
        </div>
        <Switch
          checked={quietEnabled}
          onCheckedChange={(v) => update(quietHoursPatch(v))}
          aria-label="Enable quiet hours"
          disabled={!pref.enabled}
          className="shrink-0"
        />
      </div>

      {quietEnabled ? (
        <div className="flex items-center gap-[var(--space-3)] pl-[var(--space-1)]">
          <div className="flex flex-col gap-[var(--space-1)]">
            <label
              htmlFor="quiet-start"
              className="text-[length:var(--text-xs)] text-text-muted"
            >
              From
            </label>
            <Select
              id="quiet-start"
              selectSize="sm"
              value={pref.quietHoursStart ?? DEFAULT_QUIET_HOURS.start}
              onChange={(e) => update({ quietHoursStart: Number(e.target.value) })}
              disabled={!pref.enabled}
            >
              <HourOptions />
            </Select>
          </div>
          <div className="flex flex-col gap-[var(--space-1)]">
            <label
              htmlFor="quiet-end"
              className="text-[length:var(--text-xs)] text-text-muted"
            >
              To
            </label>
            <Select
              id="quiet-end"
              selectSize="sm"
              value={pref.quietHoursEnd ?? DEFAULT_QUIET_HOURS.end}
              onChange={(e) => update({ quietHoursEnd: Number(e.target.value) })}
              disabled={!pref.enabled}
            >
              <HourOptions />
            </Select>
          </div>
        </div>
      ) : null}

      <FormActions align="start" density="compact">
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
        {status === "saved" ? (
          <span className="text-[length:var(--text-xs)] text-text-muted" aria-live="polite">
            Saved
          </span>
        ) : status === "error" ? (
          <span
            className="text-[length:var(--text-xs)] text-danger-text"
            role="alert"
          >
            Couldn&apos;t save — try again
          </span>
        ) : null}
      </FormActions>
    </div>
  );
}
