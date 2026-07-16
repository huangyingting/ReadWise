"use client";

/**
 * ReaderMiniPlayer (M5)
 *
 * Docked fixed-bottom audio transport. Appears only after narration has been
 * loaded (first Listen-tab activation succeeds). Drives the shared <audio>
 * element via ReaderAudioProvider context.
 *
 * Controls: Play/Pause · Skip −10s · Skip +10s · Seek bar (teal fill) ·
 * Time readout · Speed select · Loop toggle · Close (per-session dismiss).
 *
 * Mini-player is absent when: narration not yet loaded, or API returned
 * fallback:true (speech service unconfigured).
 */

import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  X,
  Repeat1,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Button, Popover, Tooltip } from "@/components/ui";
import { useReaderAudio } from "./ReaderAudioProvider";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;
const SKIP_SECONDS = 10;
const CONTROL_ICON_SIZE = 16;

function formatTime(secs: number): string {
  if (!isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function clampPlaybackTime(time: number, duration: number): number {
  return Math.max(0, Math.min(time, duration || 0));
}

export default function ReaderMiniPlayer() {
  const { audioRef, isLoaded, isFallback, isLooping, toggleLoop, segments } = useReaderAudio();

  const [dismissed, setDismissed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  // Percentage for the seek input gradient fill
  const seekPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Sync state from the shared audio element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
    };
    const onPause = () => {
      setIsPlaying(false);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onDurationChange = () => {
      setDuration(audio.duration);
    };
    const onEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef, isLoaded]); // re-attach when audio src loads

  if (!isLoaded || isFallback || dismissed) return null;

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampPlaybackTime(audio.currentTime + seconds, audio.duration);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = (Number.parseFloat(e.target.value) / 100) * (audio.duration || 0);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function selectSpeed(v: (typeof SPEEDS)[number]) {
    setSpeed(v);
    if (audioRef.current) audioRef.current.playbackRate = v;
  }

  const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  const canLoop = segments.length > 0;

  return (
    <div
      className="reader-mini-player"
      role="region"
      aria-label="Audio player"
    >
      {/* Left: skip back / play-pause / skip forward */}
      <div className="reader-mini-player-left">
        <IconButton
          aria-label="Skip back 10 seconds"
          context="reading"
          onClick={() => skip(-SKIP_SECONDS)}
        >
          <Rewind size={CONTROL_ICON_SIZE} />
        </IconButton>

        <IconButton
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={togglePlay}
          className="h-9 w-9 rounded-[var(--radius-full)] bg-primary text-on-primary hover:bg-primary-hover active:scale-95"
        >
          {isPlaying ? (
            <Pause size={CONTROL_ICON_SIZE} />
          ) : (
            <Play size={CONTROL_ICON_SIZE} />
          )}
        </IconButton>

        <IconButton
          aria-label="Skip forward 10 seconds"
          context="reading"
          onClick={() => skip(SKIP_SECONDS)}
        >
          <FastForward size={CONTROL_ICON_SIZE} />
        </IconButton>
      </div>

      {/* Center: seek bar + time */}
      <div className="reader-mini-player-center">
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={seekPct}
          onChange={handleSeek}
          className="reader-seek"
          style={{ "--seek-pct": `${seekPct}%` } as React.CSSProperties}
          aria-label="Seek"
          aria-valuetext={timeText}
        />
        <span className="reader-mini-player-time" aria-hidden="true">
          {timeText}
        </span>
      </div>

      {/* Right: speed + loop + close */}
      <div className="reader-mini-player-right">
        <SpeedControl speed={speed} onSelect={selectSpeed} />

        {/* Sentence loop toggle — disabled when no segments available */}
        <Tooltip content={isLooping ? "Stop looping sentence" : "Loop current sentence"}>
          <IconButton
            aria-label={isLooping ? "Stop looping sentence" : "Loop current sentence"}
            aria-pressed={isLooping}
            context="reading"
            onClick={toggleLoop}
            disabled={!canLoop}
            className={cn(isLooping && "text-primary")}
          >
            <Repeat1 size={CONTROL_ICON_SIZE} />
          </IconButton>
        </Tooltip>

        <Tooltip content="Close audio player">
          <IconButton
            aria-label="Close audio player"
            context="reading"
            onClick={() => {
              audioRef.current?.pause();
              setDismissed(true);
            }}
          >
            <X size={CONTROL_ICON_SIZE} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

const SPEED_MENU_ITEM_CLASS = cn(
  "h-auto w-full justify-between gap-[var(--space-4)] rounded-none",
  "px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-normal",
  "text-text hover:bg-bg-subtle",
);

/**
 * Playback-speed dropdown built on the shared Popover primitive (replaces the
 * native <select>). The trigger shows the current rate; the panel is a
 * `listbox` of speed options with the active rate marked by a check and
 * keyboard roving handled by Popover.
 */
function SpeedControl({
  speed,
  onSelect,
}: {
  speed: (typeof SPEEDS)[number];
  onSelect: (value: (typeof SPEEDS)[number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Playback speed: ${speed}\u00d7`}
        onClick={() => setOpen((v) => !v)}
        trailingIcon={
          <ChevronDown
            size={14}
            aria-hidden
            className={cn(
              "transition-transform [transition-duration:var(--duration-fast)]",
              open && "rotate-180",
            )}
          />
        }
        className="min-w-[64px] gap-[var(--space-1)] px-[var(--space-2)] font-medium tabular-nums"
      >
        {speed}&times;
      </Button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label="Playback speed"
        align="end"
      >
        <ul role="listbox" aria-label="Playback speed" className="min-w-[120px]">
          {SPEEDS.map((value) => {
            const selected = value === speed;
            return (
              <li key={value}>
                <Button
                  variant="ghost"
                  size="sm"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelect(value);
                    setOpen(false);
                  }}
                  trailingIcon={selected ? <Check size={14} aria-hidden /> : undefined}
                  className={cn(
                    SPEED_MENU_ITEM_CLASS,
                    selected && "font-semibold text-primary-text",
                  )}
                >
                  <span className="tabular-nums">{value}&times;</span>
                </Button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
}
