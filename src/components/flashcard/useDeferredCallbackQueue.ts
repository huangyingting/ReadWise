import { useCallback, useEffect, useRef } from "react";

type TimerHandle = ReturnType<typeof setTimeout>;

export function useDeferredCallbackQueue() {
  const timersRef = useRef<Set<TimerHandle>>(new Set());

  const schedule = useCallback((callback?: () => void) => {
    if (!callback) return;

    let handle: TimerHandle | null = null;
    const run = () => {
      if (handle != null) {
        timersRef.current.delete(handle);
      }
      callback();
    };

    handle = setTimeout(run, 0);
    timersRef.current.add(handle);
  }, []);

  const clearScheduled = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    return clearScheduled;
  }, [clearScheduled]);

  return schedule;
}
