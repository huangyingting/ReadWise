"use client";

/**
 * ReaderDisplayPanel — reader display-settings controls (REF-055).
 *
 * Pure presentational panel extracted from ReaderControls. Contains:
 *   1. Text-size stepper (−/value/+, 5 steps).
 *   2. Reading-mode radiogroup (Light / Sepia / Dark).
 *   3. Font-family radiogroup (Serif / Sans / Dyslexic).
 *   4. Line-spacing radiogroup (Normal / Comfortable / Spacious).
 *
 * Accessibility preserved from original ReaderControls:
 *   - Stepper uses two real <button>s with aria-label, disabled at limits.
 *   - The three SegmentedControls implement the radiogroup pattern.
 *   - Mode/font/spacing options carry tooltip text.
 *
 * The aria-live announcement region lives in the parent toolbar
 * (ReaderControls) so it persists in the DOM regardless of panel open state,
 * which is required for reliable screen-reader delivery.
 */

import { Sun, Contrast, Moon } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import {
  fontScaleLabel,
  DEFAULT_FONT_SCALE,
  type ReaderPrefs,
  type ReadingMode,
  type ReadingFont,
  type ReadingSpacing,
} from "@/lib/reader-prefs";

// ---------------------------------------------------------------------------
// Option registries (scoped to this module, sourced from the pref schema)
// ---------------------------------------------------------------------------

const MODE_OPTIONS = [
  { value: "light" as ReadingMode, label: "Light", icon: Sun, tooltip: "Light reading theme" },
  { value: "sepia" as ReadingMode, label: "Sepia", icon: Contrast, tooltip: "Sepia reading theme" },
  { value: "dark" as ReadingMode, label: "Dark", icon: Moon, tooltip: "Dark reading theme" },
];

const FONT_OPTIONS = [
  { value: "serif" as ReadingFont, label: "Serif", tooltip: "Serif font (Georgia)" },
  { value: "sans" as ReadingFont, label: "Sans", tooltip: "Sans-serif font" },
  { value: "dyslexic" as ReadingFont, label: "Dyslexic", tooltip: "OpenDyslexic — easier for dyslexic readers" },
];

const SPACING_OPTIONS = [
  { value: "normal" as ReadingSpacing, label: "Normal", tooltip: "Normal line spacing" },
  { value: "comfortable" as ReadingSpacing, label: "Comfortable", tooltip: "Comfortable spacing (WCAG 1.4.12)" },
  { value: "spacious" as ReadingSpacing, label: "Spacious", tooltip: "Spacious spacing (WCAG 1.4.12)" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ReaderDisplayPanelProps {
  /** Current resolved prefs (never null). */
  prefs: ReaderPrefs;
  /** True when font scale is already at the smallest step. */
  atMin: boolean;
  /** True when font scale is already at the largest step. */
  atMax: boolean;
  onScaleDown: () => void;
  onScaleUp: () => void;
  onPrefsChange: (next: Partial<ReaderPrefs>) => void;
}

export function ReaderDisplayPanel({
  prefs,
  atMin,
  atMax,
  onScaleDown,
  onScaleUp,
  onPrefsChange,
}: ReaderDisplayPanelProps) {
  return (
    <div className="reader-display-panel">
      {/* Text size */}
      <div className="reader-display-row">
        <span className="reader-display-label" id="reader-textsize-label">
          Text size
        </span>
        <div
          className="reader-display-stepper"
          role="group"
          aria-labelledby="reader-textsize-label"
        >
          <IconButton
            aria-label="Decrease text size"
            disabled={atMin}
            onClick={onScaleDown}
            className="border border-border"
          >
            <span aria-hidden="true" className="text-[length:0.8em]">
              A
            </span>
            <span aria-hidden="true">−</span>
          </IconButton>
          <span
            aria-hidden="true"
            className="reader-display-stepper-value tabular-nums select-none"
          >
            {prefs.fontScale === DEFAULT_FONT_SCALE
              ? "1×"
              : fontScaleLabel(prefs.fontScale)}
          </span>
          <IconButton
            aria-label="Increase text size"
            disabled={atMax}
            onClick={onScaleUp}
            className="border border-border"
          >
            <span aria-hidden="true" className="text-[length:1.05em]">
              A
            </span>
            <span aria-hidden="true">+</span>
          </IconButton>
        </div>
      </div>

      {/* Reading mode */}
      <div className="reader-display-row">
        <span className="reader-display-label">Reading mode</span>
        <SegmentedControl
          label="Reading theme"
          size="sm"
          value={prefs.mode}
          onChange={(mode) => onPrefsChange({ mode })}
          options={MODE_OPTIONS}
        />
      </div>

      {/* Font family */}
      <div className="reader-display-row">
        <span className="reader-display-label">Font</span>
        <SegmentedControl
          label="Reading font"
          size="sm"
          value={prefs.fontFamily}
          onChange={(fontFamily) => onPrefsChange({ fontFamily })}
          options={FONT_OPTIONS}
        />
      </div>

      {/* Line spacing */}
      <div className="reader-display-row">
        <span className="reader-display-label">Line spacing</span>
        <SegmentedControl
          label="Line spacing"
          size="sm"
          value={prefs.lineSpacing}
          onChange={(lineSpacing) => onPrefsChange({ lineSpacing })}
          options={SPACING_OPTIONS}
        />
      </div>
    </div>
  );
}
