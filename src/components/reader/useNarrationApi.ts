"use client";

/**
 * useNarrationApi — narration API adapter (REF-030).
 *
 * Extracted from ReaderAudioProvider.  Handles:
 *  - POST /api/reader/[id]/speech → narration data fetch
 *  - authenticated audio URL handoff to the shared browser player
 *
 * Idempotent: once a successful fetch completes, subsequent calls to
 * `warmNarration` are no-ops.  A failed call may be retried.
 */

import { useCallback, useRef, useState } from "react";
import { clientErrorMessage, postJson } from "@/lib/client-fetch";
import type { SpeechWord } from "@/lib/speech/timing";

interface UseNarrationApiOptions {
  /** Called with the authenticated audio URL and metadata when narration loads. */
  onLoaded: (
    audioUrl: string,
    words: SpeechWord[],
    voice: string,
    cached: boolean,
    plainText: string,
  ) => void;
  /** Called when the API returns fallback:true or no audio data. */
  onFallback: () => void;
}

export interface NarrationApiState {
  /** True while the narration fetch is in flight. */
  isWarming: boolean;
  /** Error message from the last failed fetch, or null. */
  warmError: string | null;
  /** Fetch narration for the given article and seed the player. */
  warmNarration: (articleId: string) => Promise<void>;
}

interface SpeechResponse {
  audioUrl: string | null;
  plainText: string;
  words: SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
}

function speechEndpoint(articleId: string): string {
  return `/api/reader/${articleId}/speech`;
}

export function useNarrationApi({
  onLoaded,
  onFallback,
}: UseNarrationApiOptions): NarrationApiState {
  const [isWarming, setIsWarming] = useState(false);
  const [warmError, setWarmError] = useState<string | null>(null);
  const hasWarmedRef = useRef(false);

  const warmNarration = useCallback(
    async (articleId: string): Promise<void> => {
      if (hasWarmedRef.current) return;
      hasWarmedRef.current = true;
      setIsWarming(true);
      setWarmError(null);
      try {
        const body = await postJson<SpeechResponse>(speechEndpoint(articleId), {});
        if (body.fallback || !body.audioUrl) {
          onFallback();
        } else {
          onLoaded(body.audioUrl, body.words, body.voice, body.cached, body.plainText);
        }
      } catch (err) {
        // Allow a retry on failure.
        hasWarmedRef.current = false;
        setWarmError(clientErrorMessage(err, "Could not load narration"));
      } finally {
        setIsWarming(false);
      }
    },
    [onLoaded, onFallback],
  );

  return { isWarming, warmError, warmNarration };
}
