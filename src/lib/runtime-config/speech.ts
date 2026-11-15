/**
 * Azure Speech (TTS) configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { defineFeatureConfig, envValue, type FeatureConfig } from "./env";
import { aiServicesIdentity, azureAuthMode } from "./azure-auth";

type SpeechSettings = {
  region: string;
  voice: string;
  format: string;
};

/**
 * Key auth uses AZURE_SPEECH_KEY. Entra auth (AZURE_SPEECH_AUTH=entra) uses the
 * shared AZURE_AI_* identity and the resource's custom-domain
 * AZURE_SPEECH_ENDPOINT, where the STS endpoint accepts bearer tokens.
 */
export type SpeechConfig = SpeechSettings &
  ({ auth: "key"; key: string } | { auth: "entra"; endpoint: string });

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
  const region = envValue("AZURE_SPEECH_REGION");
  if (!region) {
    return null;
  }
  const settings: SpeechSettings = {
    region,
    voice: speechSetting("AZURE_SPEECH_VOICE", DEFAULT_SPEECH_VOICE),
    format: speechSetting("AZURE_SPEECH_OUTPUT_FORMAT", DEFAULT_SPEECH_OUTPUT_FORMAT),
  };
  if (azureAuthMode("AZURE_SPEECH_AUTH") === "entra") {
    const endpoint = envValue("AZURE_SPEECH_ENDPOINT")?.replace(/\/+$/, "");
    return endpoint && aiServicesIdentity.isConfigured()
      ? { ...settings, auth: "entra", endpoint }
      : null;
  }
  const key = envValue("AZURE_SPEECH_KEY");
  return key ? { ...settings, auth: "key", key } : null;
});
