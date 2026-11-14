"use client";

/**
 * useNarrationApi — narration API adapter (REF-030).
 *
 * Extracted from ReaderAudioProvider.  Handles:
 *  - On-device narration (default): GET /api/reader/[id]/speech/text, then
 *    Paradee-8M synthesis in a Web Worker (WebGPU, WASM fallback). Playback
 *    starts from the first audio snapshot; longer snapshots follow via
 *    `onExtended` until the whole article is synthesized.
 *  - Cloud narration (opt-in, and fallback when on-device fails before any
 *    audio exists): POST /api/reader/[id]/speech → stored narration audio.
 *
 * Idempotent: once a successful fetch completes, subsequent calls to
 * `warmNarration` are no-ops.  A failed call may be retried.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clientErrorMessage, getJson, postJson } from "@/lib/client-fetch";
import { getReaderPrefs } from "@/lib/reader-prefs";
import type { SpeechWord } from "@/lib/speech/timing";
import { DEFAULT_PARADEE_VOICE } from "@/lib/ondevice-tts/voices";

interface UseNarrationApiOptions {
  /** Called with the audio URL and metadata when narration first becomes playable. */
  onLoaded: (
    audioUrl: string,
    words: SpeechWord[],
    voice: string,
    cached: boolean,
    plainText: string,
  ) => void;
  /** Called with a longer on-device snapshot of the same narration. */
  onExtended: (audioUrl: string, words: SpeechWord[]) => void;
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

function narrationTextEndpoint(articleId: string): string {
  return `/api/reader/${articleId}/speech/text`;
}

function onDeviceVoiceLabel(device: "webgpu" | "wasm"): string {
  return `${DEFAULT_PARADEE_VOICE} · Paradee-8M (${device === "webgpu" ? "WebGPU" : "WASM"})`;
}

export function useNarrationApi({
  onLoaded,
  onExtended,
  onFallback,
}: UseNarrationApiOptions): NarrationApiState {
  const [isWarming, setIsWarming] = useState(false);
  const [warmError, setWarmError] = useState<string | null>(null);
  const hasWarmedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Stop on-device synthesis when the reader unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Returns true when on-device narration produced playable audio (even if
   * synthesis later stopped), false when the caller should use cloud audio.
   */
  const warmOnDevice = useCallback(
    async (articleId: string): Promise<boolean> => {
      const { isOnDeviceTtsSupported, synthesizeNarrationOnDevice } = await import(
        "@/lib/ondevice-tts/client"
      );
      if (!isOnDeviceTtsSupported()) return false;

      const controller = new AbortController();
      abortRef.current = controller;
      let loaded = false;
      try {
        const { plainText } = await getJson<{ plainText: string }>(
          narrationTextEndpoint(articleId),
          { signal: controller.signal },
        );
        if (!plainText.trim()) return false;

        await synthesizeNarrationOnDevice(plainText, {
          signal: controller.signal,
          onSnapshot: (snapshot) => {
            const url = URL.createObjectURL(snapshot.audio);
            if (!loaded) {
              loaded = true;
              onLoaded(url, snapshot.words, onDeviceVoiceLabel(snapshot.device), false, plainText);
              setIsWarming(false);
            } else {
              onExtended(url, snapshot.words);
            }
          },
        });
        return true;
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn(
            "On-device narration failed:",
            err instanceof Error ? err.message : "unknown error",
          );
        }
        // Keep partial on-device audio playing; after an unmount abort do
        // nothing; otherwise fall back to cloud narration.
        return loaded || controller.signal.aborted;
      }
    },
    [onLoaded, onExtended],
  );

  const warmCloud = useCallback(
    async (articleId: string): Promise<void> => {
      const body = await postJson<SpeechResponse>(speechEndpoint(articleId), {});
      if (body.fallback || !body.audioUrl) {
        onFallback();
      } else {
        onLoaded(body.audioUrl, body.words, body.voice, body.cached, body.plainText);
      }
    },
    [onLoaded, onFallback],
  );

  const warmNarration = useCallback(
    async (articleId: string): Promise<void> => {
      if (hasWarmedRef.current) return;
      hasWarmedRef.current = true;
      setIsWarming(true);
      setWarmError(null);
      try {
        if (getReaderPrefs().narration === "device" && (await warmOnDevice(articleId))) {
          return;
        }
        await warmCloud(articleId);
      } catch (err) {
        // Allow a retry on failure.
        hasWarmedRef.current = false;
        setWarmError(clientErrorMessage(err, "Could not load narration"));
      } finally {
        setIsWarming(false);
      }
    },
    [warmOnDevice, warmCloud],
  );

  return { isWarming, warmError, warmNarration };
}
