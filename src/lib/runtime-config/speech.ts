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

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function speechSetting(name: string, fallback: string): string {
  return envValue(name) || fallback;
}

/**
 * Per-synthesis Azure Speech timeout in ms (SPEECH_TIMEOUT_MS, default 30000).
 */
export function speechTimeoutMs(): number {
  return positiveIntegerEnv("SPEECH_TIMEOUT_MS", DEFAULT_SPEECH_TIMEOUT_MS);
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
    voice: speechSetting("AZURE_SPEECH_VOICE", DEFAULT_SPEECH_VOICE),
    format: speechSetting("AZURE_SPEECH_OUTPUT_FORMAT", DEFAULT_SPEECH_OUTPUT_FORMAT),
  };
});
