"use client";

import { useEffect, useRef, useState } from "react";
import { useReaderAudio } from "./ReaderAudioProvider";

type SpeechResponse = {
  audio: string | null;
  mimeType: string | null;
  spokenText: string;
  words: import("./ReaderAudioProvider").SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
};

/**
 * ArticleSpeech (M5 refactor, #7 prose-highlight)
 *
 * Fetches narration on first mount and seeds ReaderAudioProvider.
 * The duplicate transcript block has been removed. Word-sync
 * highlighting is now driven by WordLookup (CSS Custom Highlight
 * API) against the main article prose, so users see karaoke
 * highlighting on the text they are actually reading.
 *
 * This component only renders transport metadata (voice name, cache
 * status) and loading/error/fallback states. Playback controls live
 * in ReaderMiniPlayer.
 *
 * Props:
 *   articleId — the article to load narration for
 *   active    — true when the Listen tab is the currently visible panel;
 *               used to gate auto-scroll of the prose highlight
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
  const [localFallback, setLocalFallback] = useState(false);
  const hasFetched = useRef(false);

  // Tell the prose highlighter whether auto-scroll is desired.
  useEffect(() => {
    audio.setListenActive(active);
  }, [active, audio]);

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
        // Hand audio src + timings to the shared provider.
        audio.loadAudio(body.audio, body.words, body.voice, body.cached);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load narration");
    } finally {
      setLoading(false);
    }
  }

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

      {!loading && !error && audio.isLoaded && !audio.isFallback ? (
        <>
          {audio.voiceMeta ? (
            <p className="muted tts-meta">
              Voice: {audio.voiceMeta.voice}
              {audio.voiceMeta.cached ? " · cached" : " · newly generated"}
            </p>
          ) : null}
          <p className="muted tts-meta">
            Words highlight in the article as audio plays.
          </p>
        </>
      ) : null}
    </div>
  );
}

