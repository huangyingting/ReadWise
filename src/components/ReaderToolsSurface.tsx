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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { getTabbable } from "@/lib/focus-trap";
import { useReaderTools } from "./ReaderToolsProvider";
import ReaderTools from "./ReaderTools";

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
  // Portal to <body> so the overlay lives OUTSIDE `#main-content`, letting us
  // mark the background inert while keeping the overlay reachable (#210).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Full-screen modal overlay on every breakpoint: focus trap + Esc + return
  // focus + body scroll lock while open. (One always-mounted instance — the
  // panel is only ever CSS-hidden, never unmounted, so in-progress quiz/tutor/
  // dictation state survives open/close.)
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // Focus the currently-selected tab on open (not the close button), so
    // keyboard users land on the active tool (#210).
    const activeTabEl = panel?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const first = getTabbable(panel)[0];
    (activeTabEl ?? first ?? panel)?.focus();

    // Lock background scroll behind the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Make the app background inert + hidden from assistive tech so SR/keyboard
    // can't reach it. The overlay is portaled OUTSIDE `#main-content`, so this
    // never inerts the overlay itself.
    const main = document.getElementById("main-content");
    const prevAriaHidden = main?.getAttribute("aria-hidden") ?? null;
    const prevInert = main?.hasAttribute("inert") ?? false;
    if (main) {
      main.setAttribute("aria-hidden", "true");
      main.setAttribute("inert", "");
    }

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
      if (main) {
        if (prevInert) main.setAttribute("inert", "");
        else main.removeAttribute("inert");
        if (prevAriaHidden === null) main.removeAttribute("aria-hidden");
        else main.setAttribute("aria-hidden", prevAriaHidden);
      }
      restoreFocusRef.current?.focus();
    };
  }, [open, closeTools]);

  const surface = (
    <aside
      ref={panelRef}
      id="reader-tools-surface"
      className="reader-tools-surface"
      data-open={open ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-tools-title"
      aria-hidden={open ? undefined : "true"}
      tabIndex={-1}
    >
      <div className="reader-tools-surface-header">
        <h2 id="reader-tools-title" className="reader-tools-surface-title">
          Practice tools
        </h2>
        <IconButton
          aria-label="Close practice tools"
          onClick={closeTools}
          className="reader-tools-close-btn"
        >
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="reader-tools-surface-body">
        <ReaderTools articleId={articleId} plainText={plainText} />
      </div>
    </aside>
  );

  if (!mounted) return null;
  return createPortal(surface, document.body);
}
