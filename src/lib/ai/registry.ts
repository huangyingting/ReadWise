/**
 * AI provider registry / factory (RW-023).
 *
 * Selects the active {@link AiProvider} from the environment (default Azure
 * OpenAI) and exposes a small override seam so tests can swap in a fake provider
 * without touching the network. The rest of the app should never import a
 * concrete provider — it goes through `@/lib/ai`, which calls
 * {@link getAiProvider}.
 *
 * Adding a new provider later: implement {@link AiProvider}, register it in
 * {@link createProviderFor}, and select it via `AI_PROVIDER=<id>`.
 */

import type { AiProvider } from "@/lib/ai/provider";
import { AzureOpenAiProvider, AZURE_PROVIDER_ID } from "@/lib/ai/azure-provider";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("ai-registry");

let override: AiProvider | null = null;
let cached: AiProvider | null = null;
let cachedKey: string | null = null;

/** The env key selecting the provider implementation. */
function providerKey(): string {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : "azure";
}

/** Builds a provider instance for the given selector key. */
function createProviderFor(key: string): AiProvider {
  switch (key) {
    case "azure":
    case "azure-openai":
    case AZURE_PROVIDER_ID:
      return new AzureOpenAiProvider();
    default:
      // Unknown selectors degrade to the supported default rather than crash —
      // matching the project's graceful-config convention. Log the fallback so
      // a misconfigured AI_PROVIDER is visible (selector only; no secrets).
      log.warn("ai.unknown_provider", { provider: key, fallback: AZURE_PROVIDER_ID });
      return new AzureOpenAiProvider();
  }
}

/**
 * Returns the active AI provider. A test override (see {@link setAiProvider})
 * always wins; otherwise the provider is chosen from `AI_PROVIDER` and cached
 * until the selector changes.
 */
export function getAiProvider(): AiProvider {
  if (override) return override;
  const key = providerKey();
  if (!cached || cachedKey !== key) {
    cached = createProviderFor(key);
    cachedKey = key;
  }
  return cached;
}

/**
 * Overrides the active provider (test seam). Pass a fake {@link AiProvider} to
 * exercise the orchestration in `@/lib/ai` without a real network call. Call
 * {@link resetAiProvider} (or `setAiProvider(null)`) to restore env selection.
 */
export function setAiProvider(provider: AiProvider | null): void {
  override = provider;
}

/** Clears any override and the cached provider (test cleanup). */
export function resetAiProvider(): void {
  override = null;
  cached = null;
  cachedKey = null;
}
