/**
 * Azure Speech (TTS) configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { defineFeatureConfig, envValue, type FeatureConfig } from "@/lib/runtime-config/env";

export type SpeechConfig = {
  key: string;
  region: string;
  voice: string;
  format: string;
};

/** Default synthesis voice when AZURE_SPEECH_VOICE is unset. */
export const DEFAULT_SPEECH_VOICE = "en-US-AndrewMultilingualNeural";
const DEFAULT_SPEECH_OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3";
const DEFAULT_SPEECH_TIMEOUT_MS = 30_000;

/**
 * Per-synthesis Azure Speech timeout in ms (SPEECH_TIMEOUT_MS, default 30000).
 */
export function speechTimeoutMs(): number {
  const v = parseInt(process.env.SPEECH_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SPEECH_TIMEOUT_MS;
}

/** Azure Speech config; voice/format fall back to project defaults. */
export const speechConfig: FeatureConfig<SpeechConfig> = defineFeatureConfig(() => {
  const key = envValue("AZURE_SPEECH_KEY");
  const region = envValue("AZURE_SPEECH_REGION");
  if (!key || !region) {
    return null;
  }
  return {
    key,
    region,
    voice: envValue("AZURE_SPEECH_VOICE") || DEFAULT_SPEECH_VOICE,
    format: envValue("AZURE_SPEECH_OUTPUT_FORMAT") || DEFAULT_SPEECH_OUTPUT_FORMAT,
  };
});
