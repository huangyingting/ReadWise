/**
 * Dictionary provider configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import path from "node:path";
import { createLogger } from "@/lib/observability/logger";
import { envValue } from "@/lib/runtime-config/env";

const log = createLogger("runtime-config.dictionary");

export type DictionaryProviderMode = "free" | "local" | "hybrid";
export type LocalDictionaryLanguage = "en" | "cn";

/**
 * Selects the dictionary backend.
 *
 * - `local`  — bundled local JSON dictionary only; no network fallback.
 * - `free`   — network-backed Free Dictionary API behavior.
 * - `hybrid` — try local first, then Free Dictionary API.
 */
export function dictionaryProviderMode(): DictionaryProviderMode {
  const raw = envValue("DICTIONARY_PROVIDER")?.toLowerCase();
  if (!raw || raw === "local") return "local";
  if (raw === "free") return "free";
  if (raw === "hybrid") return raw;
  log.warn("dictionary.unknown_provider", { value: raw, fallback: "local" });
  return "local";
}

/** Directory containing `en-50k.json` / `cn-50k.json` local dictionary files. */
export function localDictionaryDir(): string {
  return path.resolve(process.cwd(), envValue("LOCAL_DICTIONARY_DIR") ?? "dict");
}

/** Which local dictionary file to load. `zh` is accepted as an alias for `cn`. */
export function localDictionaryLanguage(): LocalDictionaryLanguage {
  const raw = envValue("LOCAL_DICTIONARY_LANGUAGE")?.toLowerCase();
  if (!raw || raw === "en") return "en";
  if (raw === "cn" || raw === "zh") return "cn";
  log.warn("dictionary.unknown_language", { value: raw, fallback: "en" });
  return "en";
}