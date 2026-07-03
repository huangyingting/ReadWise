"use client";

import type { ChangeEvent } from "react";

/**
 * DashboardLevelFilter — CEFR level filter select for the dashboard (US-017, #68).
 *
 * Wraps in a GET <form> so it degrades gracefully without JS. On the client,
 * `onChange` auto-submits the form so users don't need a separate "Go" button.
 */

import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { Button, Select } from "@/components/ui";

const LEVEL_FILTER_ID = "dashboard-level-filter";

export default function DashboardLevelFilter({
  defaultValue,
}: {
  defaultValue: string | null;
}) {
  function handleLevelChange(event: ChangeEvent<HTMLSelectElement>) {
    // Auto-submit on change (progressive enhancement).
    event.target.form?.requestSubmit();
  }

  return (
    <form method="GET" action="/dashboard" className="flex items-center gap-[var(--space-2)]">
      <label
        htmlFor={LEVEL_FILTER_ID}
        className="text-text-muted text-[length:var(--text-sm)] whitespace-nowrap"
      >
        Level
      </label>
      <Select
        id={LEVEL_FILTER_ID}
        name="level"
        defaultValue={defaultValue ?? ""}
        selectSize="sm"
        onChange={handleLevelChange}
      >
        <option value="">All levels</option>
        {ENGLISH_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {lvl} and below
          </option>
        ))}
      </Select>
      {/* No-JS fallback: visible only without JavaScript */}
      <noscript>
        <Button type="submit" variant="primary" size="sm" className="ml-[var(--space-1)]">
          Go
        </Button>
      </noscript>
    </form>
  );
}
