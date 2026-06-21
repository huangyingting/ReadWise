"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { getThemePreference, setTheme, type Theme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Inline theme picker for the Settings > Reading preferences card.
 * Three labeled buttons: Light / Dark / System.
 */
export default function SettingsThemeRow() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    setThemeState(getThemePreference());
  }, []);

  function handleSelect(value: Theme) {
    setThemeState(value);
    setTheme(value);
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <span className="text-[length:var(--text-sm)] font-medium text-text">App theme</span>
      <p className="text-text-subtle text-[length:var(--text-xs)]">
        Light, Dark, or follow your system preference.
      </p>
      <div
        role="radiogroup"
        aria-label="App theme"
        className="inline-flex gap-[var(--space-2)]"
      >
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${label} theme`}
              onClick={() => handleSelect(value)}
              className={cn(
                "inline-flex items-center gap-[var(--space-2)]",
                "px-[var(--space-3)] py-[var(--space-2)]",
                "rounded-[var(--radius-md)] border text-[length:var(--text-sm)] font-medium",
                "transition-[background-color,border-color,color] [transition-duration:var(--duration-fast)]",
                active
                  ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border-primary text-primary-text"
                  : "bg-surface border-border text-text-muted hover:border-border-strong hover:text-text",
                focusRing,
              )}
            >
              <Icon size={14} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
