"use client";

/**
 * ReaderListenButton
 *
 * Ambient "Listen" control that lives inside the sticky ReaderControls pill.
 * Clicking it warms narration (via ReaderAudioProvider.warmNarration) and
 * starts playback; the fixed bottom ReaderMiniPlayer then owns transport and
 * the article prose karaoke-highlights word-by-word (WordLookup).
 *
 * States:
 *   idle      → Volume2 icon
 *   warming   → spinner (Loader2)
 *   playing   → Pause icon
 *   paused    → Play icon
 *   fallback  → disabled (narration unavailable)
 */

import { useEffect, useRef, useState } from "react";
import { Volume2, Play, Pause, Loader2, VolumeX } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn, focusRing } from "@/lib/cn";
import { useReaderAudio } from "./ReaderAudioProvider";

export default function ReaderListenButton({ articleId }: { articleId: string }) {
  const audio = useReaderAudio();
  const [isPlaying, setIsPlaying] = useState(false);
  // Set when the user clicks Listen before audio has loaded; the effect below
  // starts playback once narration finishes warming.
  const wantPlayRef = useRef(false);

  // Mirror the shared <audio> element's play/pause state for the icon.
  useEffect(() => {
    const el = audio.audioRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [audio.audioRef, audio.isLoaded]);

  // Once narration has loaded after a click, start playback.
  useEffect(() => {
    if (audio.isLoaded && !audio.isFallback && wantPlayRef.current) {
      wantPlayRef.current = false;
      const el = audio.audioRef.current;
      if (el) void el.play();
    }
  }, [audio.isLoaded, audio.isFallback, audio.audioRef]);

  function handleClick() {
    audio.setListenActive(true);
    if (audio.isFallback) return;

    const el = audio.audioRef.current;
    if (audio.isLoaded && el) {
      if (el.paused) void el.play();
      else el.pause();
      return;
    }
    // Not loaded yet — warm it, then autoplay via the effect above.
    wantPlayRef.current = true;
    void audio.warmNarration(articleId);
  }

  const unavailable = audio.isFallback;
  const label = unavailable
    ? "Narration unavailable"
    : audio.isWarming
      ? "Loading narration…"
      : isPlaying
        ? "Pause narration"
        : audio.isLoaded
          ? "Play narration"
          : "Listen to this article";

  const icon = unavailable ? (
    <VolumeX size={14} aria-hidden />
  ) : audio.isWarming ? (
    <Loader2 size={14} aria-hidden className="reader-listen-spin" />
  ) : isPlaying ? (
    <Pause size={14} aria-hidden />
  ) : audio.isLoaded ? (
    <Play size={14} aria-hidden />
  ) : (
    <Volume2 size={14} aria-hidden />
  );

  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={isPlaying}
        disabled={unavailable}
        onClick={handleClick}
        className={cn("reader-listen-btn", focusRing)}
      >
        {icon}
        <span className="reader-listen-btn-label">Listen</span>
      </button>
    </Tooltip>
  );
}
