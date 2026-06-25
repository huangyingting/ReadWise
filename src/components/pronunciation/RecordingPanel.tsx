"use client";

import { cn } from "@/lib/cn";

type Props = {
  meterLevel: number;
  secondsRemaining: number | null;
};

export function RecordingPanel({ meterLevel, secondsRemaining }: Props) {
  return (
    <div className="rw-speak-result">
      {/* Live region: announces recording started/stopped */}
      <div
        role="status"
        aria-live="assertive"
        className="rw-speak-recording-status"
      >
        {/* Pulsing red dot */}
        <span className="rw-speak-pulse-wrap" aria-hidden>
          <span className="rw-speak-pulse-dot" />
          <span className="rw-speak-pulse-ring rw-speak-pulse-ring" />
        </span>
        <span>Recording…</span>
        {secondsRemaining !== null && (
          <span className="rw-speak-countdown" aria-live="off">
            {secondsRemaining}s
          </span>
        )}
      </div>

      {/* Mic level meter (informative, aria-hidden) */}
      <div className="rw-speak-meter" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "rw-speak-meter-seg",
              meterLevel > (i + 0.5) / 7 && "is-active",
            )}
          />
        ))}
      </div>
    </div>
  );
}
