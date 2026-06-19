"use client";

/**
 * ReaderControls (M5)
 *
 * Sticky cluster: font-size stepper (5 steps) + reading-mode segmented control
 * (Light / Sepia / Dark). Reads initial state from localStorage on mount, then
 * persists + applies on every change.
 *
 * Accessibility:
 *  - Stepper: two real <button>s, aria-label, disabled at limits.
 *  - Mode control: role="radiogroup", each option role="radio" aria-checked.
 *  - One shared aria-live="polite" region announces changes.
 *  - Arrow-key roving tabindex on the radiogroup.
 *  - All controls use focusRing.
 */

import { useEffect, useRef, useState } from "react";
import { Sun, Contrast, Moon } from "lucide-react";
import { focusRing, cn } from "@/lib/cn";
import {
  getReaderPrefs,
  setReaderPrefs,
  stepFontScale,
  fontScaleLabel,
  FONT_SCALE_STEPS,
  type ReadingMode,
  type ReaderPrefs,
} from "@/lib/reader-prefs";

const MODES: { value: ReadingMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "sepia", label: "Sepia", icon: <Contrast size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
];

export default function ReaderControls() {
  const [prefs, setPrefsState] = useState<ReaderPrefs | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const modeGroupRef = useRef<HTMLDivElement>(null);

  // On mount: read from localStorage (SSR-safe — only runs client-side).
  useEffect(() => {
    setPrefsState(getReaderPrefs());
  }, []);

  function announce(msg: string) {
    // Toggle between two messages so repeated identical changes re-trigger.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(msg));
  }

  function updatePrefs(next: Partial<ReaderPrefs>) {
    if (!prefs) return;
    const merged: ReaderPrefs = { ...prefs, ...next };
    setPrefsState(merged);
    setReaderPrefs(merged); // persist + apply to DOM
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

  // Roving tabindex for the radiogroup: arrow keys move focus.
  function handleModeKeyDown(
    e: React.KeyboardEvent,
    currentIndex: number,
  ) {
    const group = modeGroupRef.current;
    if (!group) return;
    const buttons = Array.from(
      group.querySelectorAll<HTMLButtonElement>("[role='radio']"),
    );
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (currentIndex + 1) % MODES.length;
      buttons[next]?.focus();
      handleModeChange(MODES[next].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (currentIndex - 1 + MODES.length) % MODES.length;
      buttons[prev]?.focus();
      handleModeChange(MODES[prev].value);
    } else if (e.key === "Home") {
      e.preventDefault();
      buttons[0]?.focus();
      handleModeChange(MODES[0].value);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = MODES.length - 1;
      buttons[last]?.focus();
      handleModeChange(MODES[last].value);
    }
  }

  if (!prefs) {
    // Avoid hydration mismatch — render nothing until client reads prefs.
    return null;
  }

  const atMin =
    (FONT_SCALE_STEPS as readonly number[]).indexOf(prefs.fontScale) === 0;
  const atMax =
    (FONT_SCALE_STEPS as readonly number[]).indexOf(prefs.fontScale) ===
    FONT_SCALE_STEPS.length - 1;

  return (
    <>
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

          <div className="reader-controls-divider" aria-hidden="true" />

          {/* Reading-mode segmented control */}
          <div
            ref={modeGroupRef}
            role="radiogroup"
            aria-label="Reading theme"
            className="reader-mode-group"
          >
            {MODES.map(({ value, label, icon }, i) => {
              const isActive = prefs.mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={`${label} reading theme`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleModeChange(value)}
                  onKeyDown={(e) => handleModeKeyDown(e, i)}
                  className={cn("reader-mode-btn", focusRing)}
                >
                  {icon}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
