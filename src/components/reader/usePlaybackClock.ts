"use client";

/**
 * usePlaybackClock — rAF-driven playback clock (REF-030 / #1060).
 *
 * Drives a requestAnimationFrame loop sampling audio.currentTime at ~60fps
 * while audio is playing and the document is visible.  Replaces the sole
 * reliance on the timeupdate event (~266ms cadence) for active-word updates,
 * reducing highlight onset lag from ~140ms (p50) to ~22ms (p50).
 *
 * Event-driven timeupdate remains active as a coarse fallback for background /
 * hidden tabs where the browser suspends rAF.
 *
 * Design invariants:
 *  - No stale closures: onTick is read from a ref kept current by a no-deps
 *    effect, so words / handleTimeUpdate changes are picked up without
 *    recreating or restarting the loop.
 *  - No duplicate loops: startClock calls cancelClock before scheduling.
 *  - No state update after unmount: mountedRef gate in the tick body.
 *  - Automatic restart on visibility returning visible while audio is playing.
 *  - Self-contained cleanup: unmount effect cancels any live rAF id.
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface PlaybackClockHook {
  /** Start the rAF clock. Wire to the audio element's `onPlay` handler. */
  startClock: () => void;
  /** Cancel the rAF clock. Wire to `onPause`, `onEnded`, `onError`, and source changes. */
  cancelClock: () => void;
}

export function usePlaybackClock(
  audioRef: RefObject<HTMLAudioElement | null>,
  onTick: (time: number) => void,
): PlaybackClockHook {
  const mountedRef = useRef(true);
  const rafIdRef = useRef<number>(0);
  // Keep the latest onTick without recreating the loop when words change.
  const onTickRef = useRef(onTick);

  // Runs after every render — keeps onTickRef current with no restart cost.
  useEffect(() => {
    onTickRef.current = onTick;
  });

  const cancelClock = useCallback((): void => {
    if (rafIdRef.current !== 0) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
  }, []);

  const startClock = useCallback((): void => {
    cancelClock();
    if (document.hidden) return;

    function tick(): void {
      if (!mountedRef.current) return;
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) {
        rafIdRef.current = 0;
        return;
      }
      if (document.hidden) {
        // Tab became hidden mid-loop; stop and let timeupdate take over.
        rafIdRef.current = 0;
        return;
      }
      onTickRef.current(audio.currentTime);
      rafIdRef.current = requestAnimationFrame(tick);
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }, [audioRef, cancelClock]);

  // Visibility transition: cancel on hide, restart on show while playing.
  useEffect(() => {
    function onVisibilityChange(): void {
      if (document.hidden) {
        cancelClock();
      } else {
        const audio = audioRef.current;
        if (audio && !audio.paused && !audio.ended) {
          startClock();
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [audioRef, cancelClock, startClock]);

  // Unmount: cancel any live loop and prevent tick from updating state.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelClock();
    };
  }, [cancelClock]);

  return { startClock, cancelClock };
}
