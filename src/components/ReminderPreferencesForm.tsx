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

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/Switch";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/Skeleton";

interface Preference {
  enabled: boolean;
  preferredHour: number | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

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

export default function ReminderPreferencesForm() {
  const [pref, setPref] = useState<Preference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/push/preferences")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { preference: Preference }) => {
        if (!cancelled) setPref(data.preference);
      })
      .catch(() => {
        if (!cancelled) setPref(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch: Partial<Preference>) {
    setPref((prev) => (prev ? { ...prev, ...patch } : prev));
    setStatus("idle");
  }

  async function save() {
    if (!pref) return;
    setSaving(true);
    setStatus("idle");
    try {
      const body = {
        enabled: pref.enabled,
        preferredHour: pref.preferredHour,
        // Quiet hours must be sent together (or both cleared).
        quietHoursStart: pref.quietHoursStart,
        quietHoursEnd: pref.quietHoursEnd,
        timezone: detectTimezone(),
      };
      const res = await fetch("/api/push/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { preference: Preference };
      setPref(data.preference);
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <SkeletonText lines={2} className="w-full" />;
  }
  if (!pref) {
    return null;
  }

  // Quiet hours are a paired window — toggling on seeds sensible defaults.
  const quietEnabled = pref.quietHoursStart != null && pref.quietHoursEnd != null;

  return (
    <div className="flex flex-col gap-[var(--space-4)] mt-[var(--space-4)] pt-[var(--space-4)] border-t border-border">
      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <div>
          <div className="font-medium text-text text-[length:var(--text-sm)]">
            Send review reminders
          </div>
          <div className="text-text-muted text-[length:var(--text-xs)] mt-[var(--space-0-5)]">
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
                preferredHour: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            disabled={!pref.enabled}
          >
            <option value="">Any time</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <div>
          <div className="font-medium text-text text-[length:var(--text-sm)]">
            Quiet hours
          </div>
          <div className="text-text-muted text-[length:var(--text-xs)] mt-[var(--space-0-5)]">
            Suppress reminders during this window.
          </div>
        </div>
        <Switch
          checked={quietEnabled}
          onCheckedChange={(v) =>
            update(
              v
                ? { quietHoursStart: 22, quietHoursEnd: 7 }
                : { quietHoursStart: null, quietHoursEnd: null },
            )
          }
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
              value={pref.quietHoursStart ?? 22}
              onChange={(e) => update({ quietHoursStart: Number(e.target.value) })}
              disabled={!pref.enabled}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
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
              value={pref.quietHoursEnd ?? 7}
              onChange={(e) => update({ quietHoursEnd: Number(e.target.value) })}
              disabled={!pref.enabled}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-[var(--space-3)]">
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
        {status === "saved" ? (
          <span className="text-[length:var(--text-xs)] text-text-muted" aria-live="polite">
            Saved
          </span>
        ) : status === "error" ? (
          <span
            className="text-[length:var(--text-xs)] text-[color:var(--danger-text)]"
            role="alert"
          >
            Couldn&apos;t save — try again
          </span>
        ) : null}
      </div>
    </div>
  );
}
