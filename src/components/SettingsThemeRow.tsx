"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui";
import { getThemePreference, setTheme, type Theme } from "@/lib/theme";

const THEME_OPTIONS: ReadonlyArray<SegmentedControlOption<Theme>> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];
const DEFAULT_THEME: Theme = "system";
const THEME_LABEL = "App theme";
const THEME_DESCRIPTION = "Light, Dark, or follow your system preference.";

/**
 * Inline theme picker for the Settings > Reading preferences card.
 * Three labeled buttons: Light / Dark / System.
 */
export default function SettingsThemeRow() {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    setThemeState(getThemePreference());
  }, []);

  function handleSelect(value: Theme) {
    setThemeState(value);
    setTheme(value);
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <span className="text-[length:var(--text-sm)] font-medium text-text">
        {THEME_LABEL}
      </span>
      <p className="text-text-subtle text-[length:var(--text-xs)]">
        {THEME_DESCRIPTION}
      </p>
      <SegmentedControl
        label={THEME_LABEL}
        value={theme}
        onChange={handleSelect}
        options={THEME_OPTIONS}
        size="md"
      />
    </div>
  );
}
