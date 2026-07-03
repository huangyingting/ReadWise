"use client";

import { useCallback, useState } from "react";
import type { SpeechTokenResult } from "@/components/reader/pronunciationTypes";

type SpeechTokenCache = { token: string; region: string };
type SpeechTokenResponse =
  | { configured: false }
  | { configured: true; token: string; region: string }
  | { configured: true; error: string };

const SPEECH_TOKEN_ENDPOINT = "/api/speech/token";
const SPEECH_UNAVAILABLE_MESSAGE = "Speech service is temporarily unavailable.";
const SPEECH_RETRY_MESSAGE = "Speech service is temporarily unavailable. Try again shortly.";

export function useSpeechToken() {
  const [tokenCache, setTokenCache] = useState<SpeechTokenCache | null>(null);

  const fetchToken = useCallback(async (): Promise<SpeechTokenResult> => {
    try {
      const res = await fetch(SPEECH_TOKEN_ENDPOINT);
      if (!res.ok) {
        const msg = res.status === 502 ? SPEECH_RETRY_MESSAGE : undefined;
        return { status: "transient", message: msg };
      }
      const data = (await res.json()) as SpeechTokenResponse;
      if (!data.configured) return { status: "unconfigured" };
      if ("error" in data) {
        return { status: "transient", message: SPEECH_UNAVAILABLE_MESSAGE };
      }
      return { status: "ok", token: data.token, region: data.region };
    } catch {
      return { status: "transient" };
    }
  }, []);

  const rememberToken = useCallback((token: string, region: string) => {
    setTokenCache({ token, region });
  }, []);

  return { tokenCache, rememberToken, fetchToken };
}
