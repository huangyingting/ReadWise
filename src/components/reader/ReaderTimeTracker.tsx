"use client";

/**
 * ReaderTimeTracker (#378)
 *
 * Tracks ACTIVE reading time and flushes it to the server.
 *
 * "Active" means the user is actually reading — the timer pauses on:
 *  - document.visibilityState === "hidden" (tab switch / minimise)
 *  - window blur
 *  - Idle (no scroll / click / keypress for IDLE_TIMEOUT_MS)
 *
 * and resumes on:
 *  - document becoming visible again
 *  - window focus
 *  - Any scroll, click, or keypress interaction
 *
 * Flushes are sent as a delta (time since the last flush), not a running
 * total, so the server safely accumulates them. The final flush on unmount
 * uses `keepalive: true` so it survives navigation. An inline `pagehide`
 * handler provides a last-resort beacon on hard page exits.
 *
 * Renders nothing.
 */

import { useEffect, useRef } from "react";
import { clampActiveTime } from "@/lib/reading-speed";

// Pause the timer after this many ms with no interaction.
const IDLE_TIMEOUT_MS = 30_000; // 30 s

// Flush to the server this often while reading (prevents losing a full
// session if the tab crashes before unmount).
const PERIODIC_FLUSH_MS = 60_000; // 60 s

export default function ReaderTimeTracker({ articleId }: { articleId: string }) {
  const activeStartRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const periodicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // ── Flush helper ────────────────────────────────────────────────────────
    function flush(keepalive = false): void {
      // Capture any currently-running active interval.
      let total = accumulatedMsRef.current;
      if (activeStartRef.current != null) {
        total += Date.now() - activeStartRef.current;
        activeStartRef.current = null;
      }
      accumulatedMsRef.current = 0;

      const activeMs = clampActiveTime(total);
      if (activeMs <= 0) return;

      void fetch(`/api/reader/${articleId}/reading-time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeMs }),
        keepalive,
      }).catch(() => {
        // Best-effort; a missed flush is non-critical (progress > time tracking).
      });
    }

    // ── Periodic flush ───────────────────────────────────────────────────────
    function schedulePeriodicFlush(): void {
      clearPeriodicFlush();
      periodicTimerRef.current = setTimeout(() => {
        flush(false);
        // Restart the active interval from "now" after the flush.
        if (document.visibilityState !== "hidden") {
          activeStartRef.current = Date.now();
          schedulePeriodicFlush();
        }
      }, PERIODIC_FLUSH_MS);
    }

    function clearPeriodicFlush(): void {
      if (periodicTimerRef.current != null) {
        clearTimeout(periodicTimerRef.current);
        periodicTimerRef.current = null;
      }
    }

    // ── Start / pause helpers ────────────────────────────────────────────────
    function startTracking(): void {
      if (activeStartRef.current != null) return; // already active
      activeStartRef.current = Date.now();
      schedulePeriodicFlush();
    }

    function pauseTracking(): void {
      if (activeStartRef.current == null) return; // already paused
      accumulatedMsRef.current += Date.now() - activeStartRef.current;
      activeStartRef.current = null;
      clearPeriodicFlush();
    }

    // ── Idle timer ───────────────────────────────────────────────────────────
    function resetIdleTimer(): void {
      if (idleTimerRef.current != null) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(pauseTracking, IDLE_TIMEOUT_MS);
    }

    // ── Event handlers ───────────────────────────────────────────────────────
    function handleActivity(): void {
      startTracking();
      resetIdleTimer();
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        pauseTracking();
        // Flush with keepalive on hide — the page might be discarded.
        flush(true);
      } else {
        handleActivity();
      }
    }

    function handleBlur(): void {
      pauseTracking();
    }

    function handleFocus(): void {
      handleActivity();
    }

    // Last-resort beacon when the browser fires pagehide (hard exit / BFCache).
    function handlePageHide(): void {
      flush(true);
    }

    // ── Initialise ───────────────────────────────────────────────────────────
    if (document.visibilityState !== "hidden") {
      startTracking();
      resetIdleTimer();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("scroll", handleActivity, { passive: true });
    window.addEventListener("click", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("scroll", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("keydown", handleActivity);

      clearPeriodicFlush();
      if (idleTimerRef.current != null) clearTimeout(idleTimerRef.current);

      // Final flush on unmount (navigation away). keepalive ensures delivery.
      flush(true);
    };
  }, [articleId]);

  return null;
}
