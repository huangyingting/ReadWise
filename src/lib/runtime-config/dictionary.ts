/**
 * Dictionary provider configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import path from "node:path";
import { warnRuntimeConfig } from "./internal/log";
import { envValue } from "./env";

export type DictionaryProviderMode = "free" | "local" | "hybrid";
export type LocalDictionaryLanguage = "en" | "cn";

const DEFAULT_PROVIDER_MODE: DictionaryProviderMode = "local";
const DEFAULT_LOCAL_DICTIONARY_LANGUAGE: LocalDictionaryLanguage = "en";
const LOCAL_DICTIONARY_DEFAULT_DIR = "dict";
const DICTIONARY_PROVIDER_MODES = ["free", "local", "hybrid"] as const;
const LOCAL_DICTIONARY_LANGUAGE_BY_ENV = new Map<string, LocalDictionaryLanguage>([
  ["en", "en"],
  ["cn", "cn"],
  ["zh", "cn"],
]);

/**
 * Selects the dictionary backend.
 *
 * - `local`  — bundled local JSON dictionary only; no network fallback.
 * - `free`   — network-backed Free Dictionary API behavior.
 * - `hybrid` — try local first, then Free Dictionary API.
 */
export function dictionaryProviderMode(): DictionaryProviderMode {
  const raw = envValue("DICTIONARY_PROVIDER")?.toLowerCase();
  if (!raw) return DEFAULT_PROVIDER_MODE;
  if (isDictionaryProviderMode(raw)) return raw;
  warnRuntimeConfig("runtime-config.dictionary", "dictionary.unknown_provider", {
    value: raw,
    fallback: DEFAULT_PROVIDER_MODE,
  });
  return DEFAULT_PROVIDER_MODE;
}

/** Directory containing `en-50k.json` / `cn-50k.json` local dictionary files. */
export function localDictionaryDir(): string {
  return path.resolve(process.cwd(), envValue("LOCAL_DICTIONARY_DIR") ?? LOCAL_DICTIONARY_DEFAULT_DIR);
}

/** Which local dictionary file to load. `zh` is accepted as an alias for `cn`. */
export function localDictionaryLanguage(): LocalDictionaryLanguage {
  const raw = envValue("LOCAL_DICTIONARY_LANGUAGE")?.toLowerCase();
  if (!raw) return DEFAULT_LOCAL_DICTIONARY_LANGUAGE;
  const language = LOCAL_DICTIONARY_LANGUAGE_BY_ENV.get(raw);
  if (language) return language;
  warnRuntimeConfig("runtime-config.dictionary", "dictionary.unknown_language", {
    value: raw,
    fallback: DEFAULT_LOCAL_DICTIONARY_LANGUAGE,
  });
  return DEFAULT_LOCAL_DICTIONARY_LANGUAGE;
}

function isDictionaryProviderMode(value: string): value is DictionaryProviderMode {
  return DICTIONARY_PROVIDER_MODES.includes(value as DictionaryProviderMode);
}
