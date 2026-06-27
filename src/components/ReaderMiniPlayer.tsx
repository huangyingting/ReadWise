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

import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  X,
  Repeat1,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Select } from "@/components/ui";
import { useReaderAudio } from "./ReaderAudioProvider";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

function formatTime(secs: number): string {
  if (!isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
          onClick={() => skip(-10)}
        >
          <Rewind size={16} />
        </IconButton>

        <IconButton
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={togglePlay}
          className="h-9 w-9 rounded-[var(--radius-full)] bg-primary text-on-primary hover:bg-primary-hover active:scale-95"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </IconButton>

        <IconButton
          aria-label="Skip forward 10 seconds"
          context="reading"
          onClick={() => skip(10)}
        >
          <FastForward size={16} />
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
        <Select
          value={speed}
          onChange={handleSpeed}
          aria-label="Playback speed"
          selectSize="sm"
          className="reader-speed-select"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </Select>

        {/* Sentence loop toggle — disabled when no segments available */}
        <IconButton
          aria-label={isLooping ? "Stop looping sentence" : "Loop current sentence"}
          aria-pressed={isLooping}
          context="reading"
          onClick={toggleLoop}
          disabled={!canLoop}
          className={cn(isLooping && "text-primary")}
          title={isLooping ? "Stop looping sentence" : "Loop current sentence"}
        >
          <Repeat1 size={16} />
        </IconButton>

        <IconButton
          aria-label="Close audio player"
          context="reading"
          onClick={() => {
            audioRef.current?.pause();
            setDismissed(true);
          }}
        >
          <X size={16} />
        </IconButton>
      </div>
    </div>
  );
}
