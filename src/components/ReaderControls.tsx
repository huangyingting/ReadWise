"use client";

/**
 * ReaderControls (#152)
 *
 * Slim sticky reading toolbar with at most four affordances in a single row:
 *   Back · Listen · Aa · Tools
 *
 * Back + Listen reuse the existing ReaderBackButton / ReaderListenButton.
 * "Aa" opens a Display panel — a Popover anchored to the Aa button on desktop
 * (>=sm) and a bottom Sheet on mobile (<sm) — containing, top-to-bottom:
 *   1. Text size: −/value/+ stepper (5 steps).
 *   2. Reading mode: SegmentedControl (Light / Sepia / Dark).
 *   3. Font family: SegmentedControl (Serif / Sans / Dyslexic).
 *   4. Line spacing: SegmentedControl (Normal / Comfortable / Spacious).
 * "Tools" is an inert placeholder here — wired in #153.
 *
 * Accessibility:
 *  - Stepper: two real <button>s, aria-label, disabled at limits, announced via
 *    a shared aria-live="polite" region.
 *  - The three SegmentedControls implement the radiogroup pattern and announce
 *    their own changes through their internal live region.
 *  - Display panel: modal Sheet on mobile / Popover on desktop; Esc/outside
 *    click closes and returns focus to the Aa button.
 *  - All controls use focusRing. reader-prefs API + no-flash script unchanged.
 */

import { useEffect, useRef, useState } from "react";
import { Sun, Contrast, Moon, PanelRight } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { focusRing, cn } from "@/lib/cn";
import ReaderListenButton from "./ReaderListenButton";
import ReaderBackButton from "./ReaderBackButton";
import { useReaderTools } from "./ReaderToolsProvider";
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

export default function ReaderControls({ articleId }: { articleId: string }) {
  const { open: toolsOpen, toggle: toggleTools } = useReaderTools();
  const [prefs, setPrefsState] = useState<ReaderPrefs | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [displayOpen, setDisplayOpen] = useState(false);
  // Decided at runtime: desktop (>=sm) uses a Popover, mobile (<sm) a Sheet.
  const [isDesktop, setIsDesktop] = useState(false);
  const aaButtonRef = useRef<HTMLButtonElement>(null);

  // On mount: read from localStorage (SSR-safe — only runs client-side).
  useEffect(() => {
    setPrefsState(getReaderPrefs());
  }, []);

  // Track the breakpoint so we mount only the relevant overlay.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
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

  function closeDisplay() {
    setDisplayOpen(false);
  }

  const displayPrefs = prefs ?? DEFAULT_READER_PREFS;

  const atMin =
    (FONT_SCALE_STEPS as readonly number[]).indexOf(displayPrefs.fontScale) === 0;
  const atMax =
    (FONT_SCALE_STEPS as readonly number[]).indexOf(displayPrefs.fontScale) ===
    FONT_SCALE_STEPS.length - 1;

  const displayPanel = (
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
          <span
            aria-hidden="true"
            className="reader-display-stepper-value tabular-nums select-none"
          >
            {displayPrefs.fontScale === DEFAULT_FONT_SCALE
              ? "1×"
              : fontScaleLabel(displayPrefs.fontScale)}
          </span>
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
        </div>
      </div>

      {/* Reading mode */}
      <div className="reader-display-row">
        <span className="reader-display-label">Reading mode</span>
        <SegmentedControl
          label="Reading theme"
          size="sm"
          value={displayPrefs.mode}
          onChange={(mode) => updatePrefs({ mode })}
          options={MODE_OPTIONS}
        />
      </div>

      {/* Font family */}
      <div className="reader-display-row">
        <span className="reader-display-label">Font</span>
        <SegmentedControl
          label="Reading font"
          size="sm"
          value={displayPrefs.fontFamily}
          onChange={(fontFamily) => updatePrefs({ fontFamily })}
          options={FONT_OPTIONS}
        />
      </div>

      {/* Line spacing */}
      <div className="reader-display-row">
        <span className="reader-display-label">Line spacing</span>
        <SegmentedControl
          label="Line spacing"
          size="sm"
          value={displayPrefs.lineSpacing}
          onChange={(lineSpacing) => updatePrefs({ lineSpacing })}
          options={SPACING_OPTIONS}
        />
      </div>
    </div>
  );

  return (
    <div className="reader-controls" aria-label="Reading settings" suppressHydrationWarning>
      {/* sr-only live region for stepper announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="reader-sr-live"
      >
        {announcement}
      </div>

      {/* Back — returns to the listing the user came from */}
      <ReaderBackButton />

      <div className="reader-controls-actions">
        {/* Listen — ambient narration control (plays via the bottom mini-player) */}
        <ReaderListenButton articleId={articleId} />

        <div className="reader-controls-divider" aria-hidden="true" />

        {/* Aa — opens the Display panel (Popover on desktop, Sheet on mobile) */}
        <div className="reader-display-anchor">
          <Tooltip content="Display settings" side="bottom">
            <button
              ref={aaButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={displayOpen}
              aria-label="Display settings"
              onClick={() => setDisplayOpen((open) => !open)}
              className={cn("reader-tool-btn", focusRing)}
            >
              <span aria-hidden="true" className="reader-aa-glyph">
                Aa
              </span>
            </button>
          </Tooltip>

          {isDesktop ? (
            <Popover
              open={displayOpen}
              onClose={closeDisplay}
              anchorRef={aaButtonRef}
              label="Display settings"
              align="end"
            >
              {displayPanel}
            </Popover>
          ) : (
            <Sheet
              open={displayOpen}
              onClose={closeDisplay}
              side="bottom"
              label="Display settings"
            >
              <div className="reader-display-sheet-header">
                <span className="reader-display-sheet-title">Display</span>
              </div>
              {displayPanel}
            </Sheet>
          )}
        </div>

        {/* Tools — opens the responsive practice-tools surface (#153):
            a docked right rail on xl, a focus-trapped bottom sheet on <xl. */}
        <Tooltip content="Practice tools" side="bottom">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={toolsOpen}
            aria-controls="reader-tools-surface"
            aria-label="Practice tools"
            onClick={toggleTools}
            className={cn("reader-tool-btn", toolsOpen && "is-active", focusRing)}
          >
            <PanelRight size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
