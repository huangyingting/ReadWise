"use client";

/**
 * ReaderToolsSurface (#153)
 *
 * The single, always-mounted home of <ReaderTools>. One instance on the page —
 * no duplicate tool components, so there are NO duplicate network fetches and
 * in-progress state (quiz answers, tutor chat, dictation) is preserved while the
 * surface is toggled or the breakpoint changes (it's only ever CSS-hidden, never
 * unmounted).
 *
 * Responsive behaviour (driven by CSS in globals.css, gated by `data-open`):
 *  - >= 1440px (#169): a sticky, independently scrollable RIGHT RAIL docked in
 *    the second grid column of `.reader-layout` (non-modal; no scrim, no focus
 *    trap). The threshold leaves room for the measure column AND the rail beside
 *    the collapsed sidebar, so the reading column never drops below its measure.
 *  - <  1440px:      a focus-trapped BOTTOM SHEET overlay (modal; scrim + Esc +
 *    Tab trap + return focus), closeable via scrim/Esc/close button/route change.
 *
 * z-index band (documented in globals.css too): reader toolbar (30) <
 * mini-player (40) < tools scrim/sheet (49/50) < app modals & Popovers (60).
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { useReaderTools } from "./ReaderToolsProvider";
import ReaderTools from "./ReaderTools";

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Collect the genuinely tabbable elements inside `root`.
 *
 * Mirrors the filter in `ui/Sheet.tsx`: the selector still matches roving
 * `tabindex="-1"` widgets (e.g. `SegmentedControl` options), so filter to
 * elements actually in the tab order (`el.tabIndex >= 0`) — otherwise the
 * computed "last focusable" is unreachable and Tab-wrap never fires.
 */
function getTabbable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.tabIndex >= 0);
}

/** Below this width the surface is a modal bottom sheet; at/above it's a rail. */
const SHEET_MAX_WIDTH = "(max-width: 1439.98px)";

export default function ReaderToolsSurface({
  articleId,
  plainText,
}: {
  articleId: string;
  plainText: string;
}) {
  const { open, closeTools } = useReaderTools();
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Track the breakpoint so `aria-modal`/`role` reflect the actual presentation:
  // a modal bottom sheet (<1440) vs the non-modal docked rail.
  const [isSheet, setIsSheet] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(SHEET_MAX_WIDTH);
    const update = () => setIsSheet(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Focus trap + Esc + return-focus — ONLY in bottom-sheet (modal) mode. On the
  // xl rail the surface is non-modal, so we don't steal focus or trap Tab.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const isSheetMode = window.matchMedia(SHEET_MAX_WIDTH).matches;
    if (!isSheetMode) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = getTabbable(panel)[0];
    (first ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTools();
        return;
      }
      if (event.key !== "Tab") return;
      const list = getTabbable(panel);
      if (list.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || active === panel)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, closeTools]);

  return (
    <>
      {/* Scrim — only meaningful in sheet mode (CSS hides it at xl). Rendered
          only while open so it never intercepts clicks for the rail. */}
      {open ? (
        <div
          aria-hidden="true"
          className="reader-tools-scrim"
          onClick={closeTools}
        />
      ) : null}

      <aside
        ref={panelRef}
        id="reader-tools-surface"
        className="reader-tools-surface"
        data-open={open ? "true" : "false"}
        role={isSheet ? "dialog" : undefined}
        aria-modal={isSheet ? "true" : undefined}
        aria-label="Practice tools"
        aria-hidden={open ? undefined : "true"}
        tabIndex={-1}
      >
        <div className="reader-tools-surface-header">
          <span className="reader-tools-surface-title">Practice tools</span>
          <button
            type="button"
            aria-label="Close practice tools"
            onClick={closeTools}
            className={cn("reader-tools-close-btn", focusRing)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="reader-tools-surface-body">
          <ReaderTools articleId={articleId} plainText={plainText} />
        </div>
      </aside>
    </>
  );
}
