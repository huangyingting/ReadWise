"use client";

import { useEffect, useRef, useState } from "react";
import { markArticleVisited } from "@/lib/visited";

const THROTTLE_MS = 1000;

function computeScrollPercent(): number {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  if (max <= 0) {
    return 100;
  }
  const ratio = window.scrollY / max;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

export default function ReaderProgress({
  articleId,
  initialPercent,
}: {
  articleId: string;
  initialPercent: number;
}) {
  const [percent, setPercent] = useState(initialPercent);

  const percentRef = useRef(initialPercent);
  const lastSentRef = useRef(0);
  const lastSentValueRef = useRef(initialPercent);
  const pendingRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Record this article as visited so listings refresh its progress.
    markArticleVisited(articleId);

    function send(value: number) {
      lastSentRef.current = Date.now();
      lastSentValueRef.current = value;
      void fetch(`/api/reader/${articleId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: value }),
        keepalive: true,
      }).catch(() => {
        /* best-effort; progress will be retried on next scroll */
      });
    }

    function flushPending() {
      timerRef.current = null;
      if (pendingRef.current == null) {
        return;
      }
      const value = pendingRef.current;
      pendingRef.current = null;
      if (value > lastSentValueRef.current) {
        send(value);
      }
    }

    function queue(value: number) {
      if (value <= lastSentValueRef.current) {
        return;
      }
      const elapsed = Date.now() - lastSentRef.current;
      if (elapsed >= THROTTLE_MS) {
        send(value);
        return;
      }
      // Throttle: remember the latest value and flush after the window.
      pendingRef.current = value;
      if (timerRef.current == null) {
        timerRef.current = setTimeout(flushPending, THROTTLE_MS - elapsed);
      }
    }

    function onScroll() {
      const next = computeScrollPercent();
      // Forward-only: never lower the displayed/stored progress.
      if (next <= percentRef.current) {
        return;
      }
      percentRef.current = next;
      setPercent(next);
      queue(next);
    }

    // Measure once on mount (handles short articles already fully visible),
    // but do not auto-scroll — the page stays at the top.
    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
      // Final flush so the latest position is persisted on navigation away.
      if (percentRef.current > lastSentValueRef.current) {
        send(percentRef.current);
      }
    };
  }, [articleId]);

  return (
    <div
      className="reading-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Reading progress"
    >
      <div className="reading-progress-bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
