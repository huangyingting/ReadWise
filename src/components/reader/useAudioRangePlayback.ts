"use client";

import { useCallback, useEffect, useRef } from "react";

export type AudioRange = {
  startTime: number;
  endTime: number;
};

type PlayRangeOptions = {
  /** Small grace window after the range end before stopping playback. */
  endGraceSeconds?: number;
  /** Called after playback reaches the end of the requested range. */
  onEnd?: () => void;
};

type StopRangeOptions = {
  /** Pause the shared audio element after detaching the range listener. */
  pause?: boolean;
};

/**
 * Plays a bounded slice of the shared Reader audio element.
 *
 * Dictation and pronunciation both need "play this sentence and stop at the
 * sentence boundary" behavior. This hook centralizes listener cleanup and pause
 * semantics so the tools don't each maintain their own `timeupdate` plumbing.
 */
export function useAudioRangePlayback(
  audioRef: React.RefObject<HTMLAudioElement | null>,
) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const stopRange = useCallback(
    (opts: StopRangeOptions = {}) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (opts.pause) {
        audioRef.current?.pause();
      }
    },
    [audioRef],
  );

  const playRange = useCallback(
    (range: AudioRange, opts: PlayRangeOptions = {}): boolean => {
      const audioEl = audioRef.current;
      if (!audioEl) return false;
      const element: HTMLAudioElement = audioEl;

      stopRange();

      const endGraceSeconds = opts.endGraceSeconds ?? 0.05;
      let cancelled = false;
      function onTimeUpdate() {
        if (cancelled) return;
        if (element.currentTime >= range.endTime + endGraceSeconds) {
          cancelled = true;
          element.pause();
          element.removeEventListener("timeupdate", onTimeUpdate);
          cleanupRef.current = null;
          opts.onEnd?.();
        }
      }

      element.addEventListener("timeupdate", onTimeUpdate);
      cleanupRef.current = () => {
        cancelled = true;
        element.removeEventListener("timeupdate", onTimeUpdate);
      };

      element.currentTime = range.startTime;
      void element.play();
      return true;
    },
    [audioRef, stopRange],
  );

  useEffect(() => () => stopRange(), [stopRange]);

  return { playRange, stopRange };
}
