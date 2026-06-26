"use client";

/**
 * ReaderControls (REF-055)
 *
 * Slim sticky reading toolbar with at most four affordances in a single row:
 *   Back · Listen · Aa · Tools
 *
 * Back + Listen reuse the existing ReaderBackButton / ReaderListenButton.
 * "Aa" opens a Display panel — a Popover anchored to the Aa button on desktop
 * (>=sm) and a bottom Sheet on mobile (<sm) — now composed from the extracted
 * ReaderDisplayPanel component.
 * "Tools" opens the practice-tools surface.
 *
 * Accessibility:
 *  - The aria-live="polite" region for font-size announcements lives HERE (not
 *    inside the panel) so it persists in the DOM regardless of panel open state,
 *    which is required for reliable screen-reader delivery.
 *  - Display panel: modal Sheet on mobile / Popover on desktop; Esc/outside
 *    click closes and returns focus to the Aa button.
 *  - All controls use focusRing.
 */

import { useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import ReaderListenButton from "./ReaderListenButton";
import ReaderBackButton from "./ReaderBackButton";
import { useReaderTools } from "./ReaderToolsProvider";
import { useReaderPrefs } from "@/components/reader/useReaderPrefs";
import { ReaderDisplayPanel } from "@/components/reader/ReaderDisplayPanel";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export default function ReaderControls({ articleId }: { articleId: string }) {
  const { open: toolsOpen, toggle: toggleTools } = useReaderTools();
  const { prefs, announcement, updatePrefs, handleScaleDown, handleScaleUp, atMin, atMax } =
    useReaderPrefs();
  const [displayOpen, setDisplayOpen] = useState(false);
  // Decided at runtime: desktop (>=sm) uses a Popover, mobile (<sm) a Sheet.
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const aaButtonRef = useRef<HTMLButtonElement>(null);

  function closeDisplay() {
    setDisplayOpen(false);
  }

  const displayPanel = (
    <ReaderDisplayPanel
      prefs={prefs}
      atMin={atMin}
      atMax={atMax}
      onScaleDown={handleScaleDown}
      onScaleUp={handleScaleUp}
      onPrefsChange={updatePrefs}
    />
  );

  return (
    <div className="reader-controls" aria-label="Reading settings" suppressHydrationWarning>
      {/* sr-only live region for font-size stepper announcements.
          Must remain in the toolbar (always in DOM) for reliable SR delivery. */}
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
            <IconButton
              ref={aaButtonRef}
              aria-haspopup="dialog"
              aria-expanded={displayOpen}
              aria-label="Display settings"
              context="reading"
              onClick={() => setDisplayOpen((open) => !open)}
            >
              <span aria-hidden="true" className="reader-aa-glyph">
                Aa
              </span>
            </IconButton>
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
          <IconButton
            aria-haspopup="dialog"
            aria-expanded={toolsOpen}
            aria-controls="reader-tools-surface"
            aria-label="Practice tools"
            context="reading"
            onClick={toggleTools}
            className={cn(
              toolsOpen &&
                "bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-primary",
            )}
          >
            <PanelRight size={16} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
