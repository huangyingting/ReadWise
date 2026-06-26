"use client";

/**
 * useNarrationApi — narration API adapter (REF-030).
 *
 * Extracted from ReaderAudioProvider.  Handles:
 *  - POST /api/reader/[id]/speech → narration data fetch
 *  - base64 → Blob URL conversion via {@link base64ToBlobUrl}
 *  - Blob URL lifecycle: revoke on replacement and on unmount
 *
 * Idempotent: once a successful fetch completes, subsequent calls to
 * `warmNarration` are no-ops.  A failed call may be retried.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { base64ToBlobUrl, revokeBlobUrl } from "@/lib/media-blob";
import type { SpeechWord } from "@/lib/speech";

interface UseNarrationApiOptions {
  /** Called with the resolved Blob URL and metadata when narration loads. */
  onLoaded: (
    blobUrl: string,
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

export function useNarrationApi({
  onLoaded,
  onFallback,
}: UseNarrationApiOptions): NarrationApiState {
  const [isWarming, setIsWarming] = useState(false);
  const [warmError, setWarmError] = useState<string | null>(null);
  const hasWarmedRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);

  const warmNarration = useCallback(
    async (articleId: string): Promise<void> => {
      if (hasWarmedRef.current) return;
      hasWarmedRef.current = true;
      setIsWarming(true);
      setWarmError(null);
      try {
        const body = await postJson<{
          audio: string | null;
          mimeType: string | null;
          plainText: string;
          words: SpeechWord[];
          voice: string;
          cached: boolean;
          fallback: boolean;
        }>(`/api/reader/${articleId}/speech`, {});
        if (body.fallback || !body.audio) {
          onFallback();
        } else {
          const blobUrl = base64ToBlobUrl(body.audio, body.mimeType ?? "audio/mpeg");
          // Revoke previous Blob URL before replacing.
          revokeBlobUrl(blobUrlRef.current);
          blobUrlRef.current = blobUrl;
          onLoaded(blobUrl, body.words, body.voice, body.cached, body.plainText);
        }
      } catch (err) {
        // Allow a retry on failure.
        hasWarmedRef.current = false;
        setWarmError(err instanceof Error ? err.message : "Could not load narration");
      } finally {
        setIsWarming(false);
      }
    },
    [onLoaded, onFallback],
  );

  // Revoke the Blob URL when the hook unmounts to avoid memory leaks.
  useEffect(
    () => () => {
      revokeBlobUrl(blobUrlRef.current);
      blobUrlRef.current = null;
    },
    [],
  );

  return { isWarming, warmError, warmNarration };
}
