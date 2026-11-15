/**
 * Cached Entra access tokens for the app's Azure AI Services identity
 * (`AZURE_AI_*`), used when Azure OpenAI or Speech runs in "entra" auth mode.
 * Server-only; tokens are never logged.
 */
import { aiServicesIdentity, type AiServicesIdentity } from "@/lib/runtime-config/azure-auth";
import { createEntraTokenProvider } from "./entra-auth";

let provider: Promise<() => Promise<string>> | null = null;
let providerKey = "";

/** Identifies the identity without secrets, so a config change rebuilds the credential. */
function identityKey(identity: AiServicesIdentity): string {
  return identity.mode === "managed-identity"
    ? `managed-identity:${identity.clientId ?? ""}`
    : `${identity.mode}:${identity.tenantId}:${identity.clientId}`;
}

/** Returns a bearer token for the Cognitive Services scope. Throws when unconfigured. */
export async function getAiServicesAccessToken(): Promise<string> {
  const identity = aiServicesIdentity.get();
  if (!identity) throw new Error("Azure AI Services Entra identity is not configured.");
  const key = identityKey(identity);
  if (!provider || key !== providerKey) {
    providerKey = key;
    const created = createEntraTokenProvider(identity);
    provider = created;
    // Never cache a failed credential construction.
    created.catch(() => {
      if (provider === created) provider = null;
    });
  }
  const getToken = await provider;
  return getToken();
}
