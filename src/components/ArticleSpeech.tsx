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
  /** Blob URL created for the audio; revoked on unmount to avoid memory leaks. */
  const blobUrlRef = useRef<string | null>(null);

  // Tell the prose highlighter whether auto-scroll is desired.
  useEffect(() => {
    audio.setListenActive(active);
  }, [active, audio]);

  // Revoke the blob URL when the component unmounts (#53).
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

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
        // Convert the base64 audio string to a blob: URL so it is not blocked
        // by CSP `media-src` in Firefox/Safari (data: URIs are not allowed by
        // the current policy; blob: URLs are — see next.config.ts) (#53).
        const base64 = body.audio.includes(",")
          ? body.audio.split(",")[1]
          : body.audio;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: body.mimeType ?? "audio/mpeg" });
        const blobUrl = URL.createObjectURL(blob);
        // Revoke any previous blob URL before replacing.
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = blobUrl;
        // Hand blob URL + timings to the shared provider.
        audio.loadAudio(blobUrl, body.words, body.voice, body.cached, body.spokenText);
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

