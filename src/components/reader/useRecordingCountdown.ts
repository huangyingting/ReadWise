"use client";

import { useCallback, useRef, useState } from "react";

type CountdownOptions = {
  maxRecordMs: number;
  countdownStartSeconds: number;
};

export function useRecordingCountdown({
  maxRecordMs,
  countdownStartSeconds,
}: CountdownOptions) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);

  const stopCountdown = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setSecondsRemaining(null);
  }, []);

  const cancelAutoStop = useCallback(() => {
    if (autoStopTimerRef.current !== null) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
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
