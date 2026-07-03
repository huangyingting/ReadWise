"use client";

import { useCallback, useRef, useState } from "react";

type CountdownOptions = {
  maxRecordMs: number;
  countdownStartSeconds: number;
};

function clearTimerRef(ref: { current: ReturnType<typeof setTimeout> | null }): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

function clearIntervalRef(ref: { current: ReturnType<typeof setInterval> | null }): void {
  if (ref.current !== null) {
    clearInterval(ref.current);
    ref.current = null;
  }
}

export function useRecordingCountdown({
  maxRecordMs,
  countdownStartSeconds,
}: CountdownOptions) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);

  const stopCountdown = useCallback(() => {
    clearIntervalRef(countdownIntervalRef);
    setSecondsRemaining(null);
  }, []);

  const cancelAutoStop = useCallback(() => {
    clearTimerRef(autoStopTimerRef);
    stopCountdown();
  }, [stopCountdown]);

  const startAutoStop = useCallback(
    (onAutoStop: () => void) => {
      cancelAutoStop();
      recordingStartRef.current = Date.now();
      countdownIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - recordingStartRef.current;
        const remaining = Math.ceil((maxRecordMs - elapsed) / 1000);
        if (remaining <= countdownStartSeconds) {
          setSecondsRemaining(Math.max(0, remaining));
        }
        if (remaining <= 0) stopCountdown();
      }, 500);
      autoStopTimerRef.current = setTimeout(onAutoStop, maxRecordMs);
    },
    [cancelAutoStop, countdownStartSeconds, maxRecordMs, stopCountdown],
  );

  return { secondsRemaining, startAutoStop, stopCountdown, cancelAutoStop };
}
