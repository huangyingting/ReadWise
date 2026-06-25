"use client";

/**
 * DashboardLevelFilter — CEFR level filter select for the dashboard (US-017, #68).
 *
 * Wraps in a GET <form> so it degrades gracefully without JS. On the client,
 * `onChange` auto-submits the form so users don't need a separate "Go" button.
 */

import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { buttonVariants } from "@/components/ui/Button";

export default function DashboardLevelFilter({
  defaultValue,
}: {
  defaultValue: string | null;
}) {
  return (
    <form method="GET" action="/dashboard" className="flex items-center gap-[var(--space-2)]">
      <label
        htmlFor="dashboard-level-filter"
        className="text-text-muted text-[length:var(--text-sm)] whitespace-nowrap"
      >
        Level
      </label>
      <select
        id="dashboard-level-filter"
        name="level"
        defaultValue={defaultValue ?? ""}
        className="text-[length:var(--text-sm)] rounded border border-border bg-surface px-[var(--space-2)] py-[var(--space-1)] text-text focus:outline-none focus:ring-2 focus:ring-teal"
        onChange={(e) => {
          // Auto-submit on change (progressive enhancement).
          e.target.form?.requestSubmit();
        }}
      >
        <option value="">All levels</option>
        {ENGLISH_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {lvl} and below
          </option>
        ))}
      </select>
      {/* No-JS fallback: visible only without JavaScript */}
        <noscript>
          <button type="submit" className={buttonVariants({ variant: "primary", size: "sm" })} style={{ marginLeft: "0.25rem" }}>
            Go
          </button>
        </noscript>
    </form>
  );
}
