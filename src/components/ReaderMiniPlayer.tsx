"use client";

/**
 * ReaderMiniPlayer (M5)
 *
 * Docked fixed-bottom audio transport. Appears only after narration has been
 * loaded (first Listen-tab activation succeeds). Drives the shared <audio>
 * element via ReaderAudioProvider context.
 *
 * Controls: Play/Pause · Skip −10s · Skip +10s · Seek bar (teal fill) ·
 * Time readout · Speed select · Close (per-session dismiss).
 *
 * Mini-player is absent when: narration not yet loaded, or API returned
 * fallback:true (speech service unconfigured).
 */

import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  X,
} from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { useReaderAudio } from "./ReaderAudioProvider";

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

function formatTime(secs: number): string {
  if (!isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ReaderMiniPlayer() {
  const { audioRef, isLoaded, isFallback } = useReaderAudio();

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

    function onPlay() {
      setIsPlaying(true);
    }
    function onPause() {
      setIsPlaying(false);
    }
    function onTimeUpdate() {
      setCurrentTime(audio!.currentTime);
    }
    function onDurationChange() {
      setDuration(audio!.duration);
    }
    function onEnded() {
      setIsPlaying(false);
    }

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
    audio.currentTime = Math.max(
      0,
      Math.min(audio.currentTime + seconds, audio.duration || 0),
    );
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = (parseFloat(e.target.value) / 100) * (audio.duration || 0);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function handleSpeed(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = parseFloat(e.target.value) as (typeof SPEEDS)[number];
    setSpeed(v);
    if (audioRef.current) audioRef.current.playbackRate = v;
  }

  const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}`;

  return (
    <div
      className="reader-mini-player"
      role="region"
      aria-label="Audio player"
    >
      {/* Left: skip back / play-pause / skip forward */}
      <div className="reader-mini-player-left">
        <button
          type="button"
          aria-label="Skip back 10 seconds"
          onClick={() => skip(-10)}
          className={cn("reader-icon-btn", focusRing)}
        >
          <Rewind size={16} />
        </button>

        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={togglePlay}
          className={cn(
            "inline-flex items-center justify-center w-9 h-9 rounded-full border-none cursor-pointer",
            "bg-primary text-on-primary flex-shrink-0",
            "transition-[background-color] [transition-duration:var(--duration-fast)]",
            "hover:bg-primary-hover active:scale-95",
            focusRing,
          )}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button
          type="button"
          aria-label="Skip forward 10 seconds"
          onClick={() => skip(10)}
          className={cn("reader-icon-btn", focusRing)}
        >
          <FastForward size={16} />
        </button>
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

      {/* Right: speed + close */}
      <div className="reader-mini-player-right">
        <select
          value={speed}
          onChange={handleSpeed}
          aria-label="Playback speed"
          className={cn("reader-speed-select", focusRing)}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-label="Close audio player"
          onClick={() => {
            audioRef.current?.pause();
            setDismissed(true);
          }}
          className={cn("reader-icon-btn", focusRing)}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
