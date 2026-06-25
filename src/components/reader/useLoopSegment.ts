"use client";

/**
 * useLoopSegment — sentence-loop audio DOM hook (REF-030).
 *
 * Extracted from ReaderAudioProvider.  Captures the sentence segment
 * containing the current playback position and loops it by seeking back to the
 * segment start on every time-update past the end.  A second `toggleLoop` call
 * cancels the loop.
 *
 * `segments` and `audioRef` are accepted as stable hook parameters so the
 * returned `toggleLoop` always closes over the current segment list and the
 * shared audio element.
 */

import { useCallback, useRef, useState } from "react";
import type { DictationSegment } from "@/lib/dictation";

export interface LoopSegmentHook {
  /** True when sentence-loop mode is active. */
  isLooping: boolean;
  /**
   * Ref to the segment currently being looped.  The `onTimeUpdate` handler
   * reads this ref directly (no re-render needed).
   */
  loopSegmentRef: React.RefObject<DictationSegment | null>;
  /**
   * Toggle loop mode.  On activation, captures the sentence at the current
   * playback position and (if past its end) seeks to its start.  Calling
   * again cancels the loop.
   */
  toggleLoop: () => void;
  /** Cancel the loop unconditionally (e.g. when new audio is loaded or ended). */
  cancelLoop: () => void;
}

export function useLoopSegment(
  segments: DictationSegment[],
  audioRef: React.RefObject<HTMLAudioElement | null>,
): LoopSegmentHook {
  const loopSegmentRef = useRef<DictationSegment | null>(null);
  const [isLooping, setIsLooping] = useState(false);

  const cancelLoop = useCallback(() => {
    loopSegmentRef.current = null;
    setIsLooping(false);
  }, []);

  const toggleLoop = useCallback(() => {
    if (loopSegmentRef.current) {
      // Cancel an active loop.
      loopSegmentRef.current = null;
      setIsLooping(false);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (segments.length === 0) return;

    const time = audio.currentTime;
    // Find the last segment whose startTime <= currentTime.
    let seg: DictationSegment | null = null;
    for (const s of segments) {
      if (s.startTime <= time) {
        seg = s;
      } else {
        break;
      }
    }
    // If before all segments, use the first one.
    if (!seg) seg = segments[0];

    loopSegmentRef.current = seg;
    setIsLooping(true);
    // Seek to sentence start if we're already past its end.
    if (time >= seg.endTime) {
      audio.currentTime = seg.startTime;
    }
  }, [segments, audioRef]);

  return { isLooping, loopSegmentRef, toggleLoop, cancelLoop };
}
