"use client";

/**
 * useNarrationApi — narration API adapter (REF-030).
 *
 * Extracted from ReaderAudioProvider.  Handles:
 *  - On-device narration (default): GET /api/reader/[id]/speech/text, then
 *    Paradee-8M synthesis in a Web Worker (WebGPU, WASM fallback). Playback
 *    starts from the first audio snapshot; longer snapshots follow via
 *    `onExtended` until the whole article is synthesized.
 *  - Cloud narration: POST /api/reader/[id]/speech → stored narration audio.
 *
 * The reader's preferred engine is tried first, then the other one
 * (`loadNarrationSource`): cloud preference falls back to on-device when no
 * stored audio exists, and on-device falls back to cloud when synthesis fails
 * before any audio exists. `recoverWithOnDevice` covers cloud audio that is
 * listed but fails to load in the <audio> element.
 *
 * Idempotent: once a successful fetch completes, subsequent calls to
 * `warmNarration` are no-ops.  A failed call may be retried.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clientErrorMessage, getJson, postJson } from "@/lib/client-fetch";
import { getReaderPrefs } from "@/lib/reader-prefs";
import type { SpeechWord } from "@/lib/speech/timing";
import { loadNarrationSource } from "./narrationSource";

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
  /** Called when neither engine can provide narration. */
  onFallback: () => void;
}

export interface NarrationApiState {
  /** True while the narration fetch is in flight. */
  isWarming: boolean;
  /** Error message from the last failed fetch, or null. */
  warmError: string | null;
  /** Fetch narration for the given article and seed the player. */
  warmNarration: (articleId: string) => Promise<void>;
  /**
   * Switch to on-device narration after cloud audio failed to load. Resolves
   * false when on-device was already tried or cannot produce audio.
   */
  recoverWithOnDevice: () => Promise<boolean>;
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

function onDeviceVoiceLabel(voice: string, device: "webgpu" | "wasm"): string {
  return `${voice} · Paradee-8M (${device === "webgpu" ? "WebGPU" : "WASM"})`;
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
  const articleIdRef = useRef<string | null>(null);
  const triedOnDeviceRef = useRef(false);

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
      triedOnDeviceRef.current = true;
      const voice = getReaderPrefs().narrationVoice;

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
          voice,
          signal: controller.signal,
          onSnapshot: (snapshot) => {
            const url = URL.createObjectURL(snapshot.audio);
            if (!loaded) {
              loaded = true;
              onLoaded(url, snapshot.words, onDeviceVoiceLabel(voice, snapshot.device), false, plainText);
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
        // nothing; otherwise let the caller try the other engine.
        return loaded || controller.signal.aborted;
      }
    },
    [onLoaded, onExtended],
  );

  /** Returns false when no stored cloud narration exists; throws on request errors. */
  const warmCloud = useCallback(
    async (articleId: string): Promise<boolean> => {
      const body = await postJson<SpeechResponse>(speechEndpoint(articleId), {});
      if (body.fallback || !body.audioUrl) return false;
      onLoaded(body.audioUrl, body.words, body.voice, body.cached, body.plainText);
      return true;
    },
    [onLoaded],
  );

  const warmNarration = useCallback(
    async (articleId: string): Promise<void> => {
      if (hasWarmedRef.current) return;
      hasWarmedRef.current = true;
      articleIdRef.current = articleId;
      triedOnDeviceRef.current = false;
      setIsWarming(true);
      setWarmError(null);
      try {
        const source = await loadNarrationSource(getReaderPrefs().narration, {
          device: () => warmOnDevice(articleId),
          cloud: () => warmCloud(articleId),
        });
        if (!source) onFallback();
      } catch (err) {
        // Allow a retry on failure.
        hasWarmedRef.current = false;
        setWarmError(clientErrorMessage(err, "Could not load narration"));
      } finally {
        setIsWarming(false);
      }
    },
    [warmOnDevice, warmCloud, onFallback],
  );

  const recoverWithOnDevice = useCallback(async (): Promise<boolean> => {
    const articleId = articleIdRef.current;
    if (!articleId || triedOnDeviceRef.current) return false;
    setIsWarming(true);
    try {
      return await warmOnDevice(articleId);
    } finally {
      setIsWarming(false);
    }
  }, [warmOnDevice]);

  return { isWarming, warmError, warmNarration, recoverWithOnDevice };
}
