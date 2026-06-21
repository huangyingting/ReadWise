"use client";

/**
 * ReaderControls (M5)
 *
 * Sticky cluster: font-size stepper (5 steps) + reading-mode segmented control
 * (Light / Sepia / Dark) + font-family picker (Serif / Sans / Dyslexic) +
 * line/letter spacing picker (Normal / Comfortable / Spacious).
 *
 * Accessibility:
 *  - Stepper: two real <button>s, aria-label, disabled at limits.
 *  - Mode control: role="radiogroup", each option role="radio" aria-checked.
 *  - Font/spacing controls: role="radiogroup", roving tabindex.
 *  - One shared aria-live="polite" region announces changes.
 *  - All controls use focusRing.
 */

import { useEffect, useRef, useState } from "react";
import { Sun, Contrast, Moon, Type, AlignLeft } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { focusRing, cn } from "@/lib/cn";
import {
  getReaderPrefs,
  setReaderPrefs,
  stepFontScale,
  fontScaleLabel,
  FONT_SCALE_STEPS,
  DEFAULT_FONT_SCALE,
  type ReadingMode,
  type ReadingFont,
  type ReadingSpacing,
  type ReaderPrefs,
} from "@/lib/reader-prefs";

/** Default prefs used for stable SSR/hydration render before localStorage loads. */
const DEFAULT_READER_PREFS: ReaderPrefs = {
  mode: "light",
  fontScale: DEFAULT_FONT_SCALE,
  fontFamily: "serif",
  lineSpacing: "normal",
};

const MODES: { value: ReadingMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "sepia", label: "Sepia", icon: <Contrast size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
];

const FONTS: { value: ReadingFont; label: string; shortLabel: string; tooltip: string }[] = [
  { value: "serif", label: "Serif", shortLabel: "Se", tooltip: "Serif font (Georgia)" },
  { value: "sans", label: "Sans", shortLabel: "Sa", tooltip: "Sans-serif font" },
  { value: "dyslexic", label: "Dyslexic", shortLabel: "Dy", tooltip: "OpenDyslexic — easier for dyslexic readers" },
];

const SPACINGS: { value: ReadingSpacing; label: string; shortLabel: string; tooltip: string }[] = [
  { value: "normal", label: "Normal", shortLabel: "1×", tooltip: "Normal line spacing" },
  { value: "comfortable", label: "Comfortable", shortLabel: "1.5×", tooltip: "Comfortable spacing (WCAG 1.4.12)" },
  { value: "spacious", label: "Spacious", shortLabel: "2×", tooltip: "Spacious spacing (WCAG 1.4.12)" },
];

export default function ReaderControls() {
  const [prefs, setPrefsState] = useState<ReaderPrefs | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const modeGroupRef = useRef<HTMLDivElement>(null);
  const fontGroupRef = useRef<HTMLDivElement>(null);
  const spacingGroupRef = useRef<HTMLDivElement>(null);

  // On mount: read from localStorage (SSR-safe — only runs client-side).
  useEffect(() => {
    setPrefsState(getReaderPrefs());
  }, []);

  function announce(msg: string) {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(msg));
  }

  function updatePrefs(next: Partial<ReaderPrefs>) {
    if (!prefs) return;
    const merged: ReaderPrefs = { ...prefs, ...next };
    setPrefsState(merged);
    setReaderPrefs(merged);
  }

  function handleScaleDown() {
    if (!prefs) return;
    const next = stepFontScale(prefs.fontScale, "down");
    updatePrefs({ fontScale: next });
    announce(`Text size: ${fontScaleLabel(next)}`);
  }

  function handleScaleUp() {
    if (!prefs) return;
    const next = stepFontScale(prefs.fontScale, "up");
    updatePrefs({ fontScale: next });
    announce(`Text size: ${fontScaleLabel(next)}`);
  }

  function handleModeChange(mode: ReadingMode) {
    updatePrefs({ mode });
    announce(`Reading theme: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
  }

  function handleFontChange(fontFamily: ReadingFont) {
    updatePrefs({ fontFamily });
    announce(`Reading font: ${fontFamily}`);
  }

  function handleSpacingChange(lineSpacing: ReadingSpacing) {
    updatePrefs({ lineSpacing });
    announce(`Line spacing: ${lineSpacing}`);
  }

  function makeRovingKeyDown<T extends { value: string }>(
    items: T[],
    groupRef: React.RefObject<HTMLDivElement | null>,
    onSelect: (value: T["value"]) => void,
    currentIndex: number,
  ) {
    return (e: React.KeyboardEvent) => {
      const group = groupRef.current;
      if (!group) return;
      const buttons = Array.from(
        group.querySelectorAll<HTMLButtonElement>("[role='radio']"),
      );
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = (currentIndex + 1) % items.length;
        buttons[next]?.focus();
        onSelect(items[next].value as T["value"]);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = (currentIndex - 1 + items.length) % items.length;
        buttons[prev]?.focus();
        onSelect(items[prev].value as T["value"]);
      } else if (e.key === "Home") {
        e.preventDefault();
        buttons[0]?.focus();
        onSelect(items[0].value as T["value"]);
      } else if (e.key === "End") {
        e.preventDefault();
        const last = items.length - 1;
        buttons[last]?.focus();
        onSelect(items[last].value as T["value"]);
      }
    };
  }

  const displayPrefs = prefs ?? DEFAULT_READER_PREFS;

  const atMin =
    (FONT_SCALE_STEPS as readonly number[]).indexOf(displayPrefs.fontScale) === 0;
  const atMax =
    (FONT_SCALE_STEPS as readonly number[]).indexOf(displayPrefs.fontScale) ===
    FONT_SCALE_STEPS.length - 1;

  return (
    <div suppressHydrationWarning>
      {/* sr-only live region for control announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="reader-sr-live"
      >
        {announcement}
      </div>

      <div className="reader-controls" aria-label="Reading settings">
        <div className="reader-controls-inner">
          {/* Font-size stepper */}
          <Tooltip content="Decrease text size" side="bottom">
            <button
              type="button"
              aria-label="Decrease text size"
              disabled={atMin}
              onClick={handleScaleDown}
              className={cn("reader-scale-btn", focusRing)}
            >
              <span aria-hidden="true" style={{ fontSize: "0.8em" }}>
                A
              </span>
              <span aria-hidden="true">−</span>
            </button>
          </Tooltip>

          {/* Current font-scale label — "1×" at default, short label otherwise */}
          <span
            aria-hidden="true"
            className="text-[length:var(--text-xs)] text-reading-text-muted tabular-nums select-none"
            style={{ minWidth: "1.8ch", textAlign: "center" }}
          >
            {displayPrefs.fontScale === DEFAULT_FONT_SCALE
              ? "1×"
              : fontScaleLabel(displayPrefs.fontScale).slice(0, 2)}
          </span>

          <Tooltip content="Increase text size" side="bottom">
            <button
              type="button"
              aria-label="Increase text size"
              disabled={atMax}
              onClick={handleScaleUp}
              className={cn("reader-scale-btn", focusRing)}
            >
              <span aria-hidden="true" style={{ fontSize: "1.05em" }}>
                A
              </span>
              <span aria-hidden="true">+</span>
            </button>
          </Tooltip>

          <div className="reader-controls-divider" aria-hidden="true" />

          {/* Reading-mode segmented control */}
          <div
            ref={modeGroupRef}
            role="radiogroup"
            aria-label="Reading theme"
            className="reader-mode-group"
          >
            {MODES.map(({ value, label, icon }, i) => {
              const isActive = displayPrefs.mode === value;
              return (
                <Tooltip key={value} content={`${label} reading theme`} side="bottom">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={`${label} reading theme`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => handleModeChange(value)}
                    onKeyDown={makeRovingKeyDown(MODES, modeGroupRef, handleModeChange, i)}
                    className={cn("reader-mode-btn", focusRing)}
                  >
                    {icon}
                  </button>
                </Tooltip>
              );
            })}
          </div>

          <div className="reader-controls-divider" aria-hidden="true" />

          {/* Font-family picker */}
          <div
            ref={fontGroupRef}
            role="radiogroup"
            aria-label="Reading font"
            className="reader-mode-group"
            title="Font family"
          >
            <Type size={12} aria-hidden className="text-reading-text-muted opacity-60 mr-px" />
            {FONTS.map(({ value, shortLabel, tooltip }, i) => {
              const isActive = displayPrefs.fontFamily === value;
              return (
                <Tooltip key={value} content={tooltip} side="bottom">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={tooltip}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => handleFontChange(value)}
                    onKeyDown={makeRovingKeyDown(FONTS, fontGroupRef, handleFontChange, i)}
                    className={cn("reader-mode-btn reader-font-btn", focusRing)}
                  >
                    <span aria-hidden="true" className="text-[length:var(--text-xs)] font-medium">
                      {shortLabel}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>

          <div className="reader-controls-divider" aria-hidden="true" />

          {/* Line/letter spacing picker */}
          <div
            ref={spacingGroupRef}
            role="radiogroup"
            aria-label="Line spacing"
            className="reader-mode-group"
          >
            <AlignLeft size={12} aria-hidden className="text-reading-text-muted opacity-60 mr-px" />
            {SPACINGS.map(({ value, shortLabel, tooltip }, i) => {
              const isActive = displayPrefs.lineSpacing === value;
              return (
                <Tooltip key={value} content={tooltip} side="bottom">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={tooltip}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => handleSpacingChange(value)}
                    onKeyDown={makeRovingKeyDown(SPACINGS, spacingGroupRef, handleSpacingChange, i)}
                    className={cn("reader-mode-btn reader-font-btn", focusRing)}
                  >
                    <span aria-hidden="true" className="text-[length:var(--text-xs)] font-medium">
                      {shortLabel}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
