"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SpeechWord = {
  textOffset: number;
  length: number;
  start: number;
  end: number;
};

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

export default function ArticleSpeech({ articleId }: { articleId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SpeechResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const segments = useMemo(
    () => (data ? buildSegments(data.spokenText, data.words) : []),
    [data],
  );

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
      setData(body);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load narration");
    } finally {
      setLoading(false);
    }
  }

  function handleToggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      void loadSpeech();
    }
  }

  // Track the active word from playback position (last word started so far).
  function updateActiveWord(time: number) {
    const words = data?.words;
    if (!words || words.length === 0) {
      return;
    }
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].start <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found !== -1 && time >= words[found].end + 0.4) {
      // Sitting in a trailing silence well past the last word — clear it.
      const next = words[found + 1];
      if (!next || time < next.start) {
        found = -1;
      }
    }
    setActiveIndex((prev) => (prev === found ? prev : found));
  }

  // Auto-scroll only when the active word leaves a comfortable viewport band.
  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    const el = wordRefs.current[activeIndex];
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const top = window.innerHeight * 0.2;
    const bottom = window.innerHeight * 0.75;
    if (rect.top < top || rect.bottom > bottom) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  return (
    <section className="tts" aria-label="Listen to article">
      <div className="tts-controls">
        <h2 className="tts-heading">Listen</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleToggleOpen}
          aria-expanded={open}
        >
          {open ? "Hide narration" : "Listen to article"}
        </button>
      </div>

      {open ? (
        <div className="tts-panel" role="region" aria-label="Article narration">
          {loading ? <p className="muted">Generating narration…</p> : null}

          {error ? (
            <p className="tts-error" role="alert">
              {error}
            </p>
          ) : null}

          {!loading && loaded && data?.fallback ? (
            <p className="muted">
              Narration is unavailable right now because the text-to-speech
              service is not configured. Please try again later.
            </p>
          ) : null}

          {!loading && data && !data.fallback && data.audio ? (
            <>
              <audio
                ref={audioRef}
                className="tts-audio"
                src={data.audio}
                controls
                preload="metadata"
                onTimeUpdate={(e) =>
                  updateActiveWord(e.currentTarget.currentTime)
                }
                onSeeked={(e) => updateActiveWord(e.currentTarget.currentTime)}
                onEnded={() => setActiveIndex(-1)}
              />
              <p className="muted tts-meta">
                Voice: {data.voice}
                {data.cached ? " · cached" : " · newly generated"}
              </p>
              <p className="tts-text" lang="en">
                {segments.map((seg, i) => {
                  if (seg.kind === "gap") {
                    return <span key={`g${i}`}>{seg.text}</span>;
                  }
                  const idx = seg.wordIndex;
                  const isActive = idx === activeIndex;
                  return (
                    <span
                      key={`w${i}`}
                      ref={(node) => {
                        wordRefs.current[idx] = node;
                      }}
                      className={`tts-word${isActive ? " is-active" : ""}`}
                      onClick={() => {
                        const audio = audioRef.current;
                        const word = data.words[idx];
                        if (audio && word) {
                          audio.currentTime = word.start;
                          void audio.play();
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
      ) : null}
    </section>
  );
}
