"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReaderAudio, type SpeechWord } from "./ReaderAudioProvider";

type SpeechResponse = {
  audio: string | null;
  mimeType: string | null;
  spokenText: string;
  words: SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
};

type Segment =
  | { kind: "gap"; text: string }
  | { kind: "word"; text: string; wordIndex: number };

/** Splits the spoken text into plain gaps and timed word spans. */
function buildSegments(text: string, words: SpeechWord[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  words.forEach((w, i) => {
    const start = Math.max(w.textOffset, cursor);
    const end = Math.min(w.textOffset + w.length, text.length);
    if (start > cursor) {
      segments.push({ kind: "gap", text: text.slice(cursor, start) });
    }
    if (end > start) {
      segments.push({
        kind: "word",
        text: text.slice(start, end),
        wordIndex: i,
      });
      cursor = end;
    }
  });
  if (cursor < text.length) {
    segments.push({ kind: "gap", text: text.slice(cursor) });
  }
  return segments;
}

/**
 * ArticleSpeech (M5 refactor)
 *
 * Stripped of its own open/close toggle and <audio> element.
 * - Fetches narration once on first mount (= first Listen-tab activation).
 * - Pushes audio src + word timings up to ReaderAudioProvider context.
 * - Renders only the transcript; transport lives in ReaderMiniPlayer.
 * - Auto-scroll fires ONLY when `active` (Listen tab is visible), so
 *   playback in the background never hijacks the user's reading scroll.
 *
 * Props:
 *   articleId — the article to load narration for
 *   active    — true when the Listen tab is the currently visible panel
 */
export default function ArticleSpeech({
  articleId,
  active,
}: {
  articleId: string;
  active: boolean;
}) {
  const audio = useReaderAudio();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spokenText, setSpokenText] = useState("");
  const [localFallback, setLocalFallback] = useState(false);
  const hasFetched = useRef(false);

  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Fetch once on mount (first Listen-tab activation = first render).
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void loadSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSpeech() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Could not load narration");
      }
      const body = (await res.json()) as SpeechResponse;
      if (body.fallback || !body.audio) {
        setLocalFallback(true);
        audio.markFallback();
      } else {
        setSpokenText(body.spokenText);
        // Hand audio src + timings to the shared provider.
        audio.loadAudio(body.audio, body.words, body.voice, body.cached);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load narration");
    } finally {
      setLoading(false);
    }
  }

  const segments = useMemo(
    () =>
      spokenText && audio.words.length > 0
        ? buildSegments(spokenText, audio.words)
        : [],
    [spokenText, audio.words],
  );

  // Auto-scroll: ONLY when Listen tab is active (visible). This prevents
  // the TTS playback from hijacking scroll while user browses other tabs.
  useEffect(() => {
    if (!active || audio.activeIndex < 0) return;
    const el = wordRefs.current[audio.activeIndex];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = window.innerHeight * 0.2;
    const bottom = window.innerHeight * 0.75;
    if (rect.top < top || rect.bottom > bottom) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [audio.activeIndex, active]);

  return (
    <div>
      {loading ? <p className="muted">Generating narration…</p> : null}

      {error ? (
        <p className="tts-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && localFallback ? (
        <p className="muted">
          Narration is unavailable right now because the text-to-speech
          service is not configured. Please try again later.
        </p>
      ) : null}

      {!loading && !error && audio.isLoaded && !audio.isFallback && segments.length > 0 ? (
        <>
          {audio.voiceMeta ? (
            <p className="muted tts-meta">
              Voice: {audio.voiceMeta.voice}
              {audio.voiceMeta.cached ? " · cached" : " · newly generated"}
            </p>
          ) : null}
          <p className="tts-text" lang="en">
            {segments.map((seg, i) => {
              if (seg.kind === "gap") {
                return <span key={`g${i}`}>{seg.text}</span>;
              }
              const idx = seg.wordIndex;
              const isActive = idx === audio.activeIndex;
              return (
                <span
                  key={`w${i}`}
                  ref={(node) => {
                    wordRefs.current[idx] = node;
                  }}
                  className={`tts-word${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    const audioEl = audio.audioRef.current;
                    const word = audio.words[idx];
                    if (audioEl && word) {
                      audioEl.currentTime = word.start;
                      void audioEl.play();
                    }
                  }}
                >
                  {seg.text}
                </span>
              );
            })}
          </p>
        </>
      ) : null}
    </div>
  );
}

