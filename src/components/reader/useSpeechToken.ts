"use client";

import { useCallback, useState } from "react";
import type { SpeechTokenResult } from "@/components/reader/pronunciationTypes";

export function useSpeechToken() {
  const [tokenCache, setTokenCache] = useState<{ token: string; region: string } | null>(null);

  const fetchToken = useCallback(async (): Promise<SpeechTokenResult> => {
    try {
      const res = await fetch("/api/speech/token");
      if (!res.ok) {
        const msg =
          res.status === 502
            ? "Speech service is temporarily unavailable. Try again shortly."
            : undefined;
        return { status: "transient", message: msg };
      }
      const data = (await res.json()) as
        | { configured: false }
        | { configured: true; token: string; region: string }
        | { configured: true; error: string };
      if (!data.configured) return { status: "unconfigured" };
      if ("error" in data) {
        return { status: "transient", message: "Speech service is temporarily unavailable." };
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
