"use client";

/**
 * ReaderToolsSurface (#153, #206 → full-screen overlay)
 *
 * The single, always-mounted home of <ReaderTools>. One instance on the page —
 * no duplicate tool components, so there are NO duplicate network fetches and
 * in-progress state (quiz answers, tutor chat, dictation) is preserved while the
 * surface is toggled (it's only ever CSS-hidden, never unmounted).
 *
 * Presentation (driven by CSS in globals.css, gated by `data-open`): a
 * FULL-SCREEN modal overlay on EVERY breakpoint — `position: fixed; inset: 0`,
 * covering the article. Modal: focus trap + Esc + return focus + body scroll
 * lock, closeable via the header close button, Esc, or a route change. A header
 * bar holds the title + close button; the tool tabs/panels are centered and
 * scroll independently below.
 *
 * z-index band: reader toolbar (30) < mini-player (40) < tools overlay (50) <
 * app modals & Popovers (60).
 */

import { useEffect, useRef } from "react";
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

  // Full-screen modal overlay on every breakpoint: focus trap + Esc + return
  // focus + body scroll lock while open. (One always-mounted instance — the
  // panel is only ever CSS-hidden, never unmounted, so in-progress quiz/tutor/
  // dictation state survives open/close.)
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = getTabbable(panel)[0];
    (first ?? panel)?.focus();

    // Lock background scroll behind the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

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
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, closeTools]);

  return (
    <aside
      ref={panelRef}
      id="reader-tools-surface"
      className="reader-tools-surface"
      data-open={open ? "true" : "false"}
      role="dialog"
      aria-modal="true"
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
  );
}
