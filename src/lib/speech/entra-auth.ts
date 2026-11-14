/**
 * Entra ID token providers for operator scripts that call Azure AI Services
 * resources with local (key) auth disabled.
 *
 * - Device code: in-memory sign-in, valid for the life of the process.
 * - Azure CLI: reuses an `az login` session, which persists on disk and
 *   refreshes silently, so restarts do not need a new sign-in.
 *
 * Tokens are cached until shortly before expiry and never logged.
 */
import type { AccessToken, DeviceCodeInfo, TokenCredential } from "@azure/identity";

export const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type EntraAuthOptions = {
  mode: "device" | "cli";
  tenantId: string;
  clientId?: string;
  prompt?: (info: DeviceCodeInfo) => void;
};

function defaultPrompt(info: DeviceCodeInfo): void {
  console.error(`Entra ID: open ${info.verificationUri} and enter code ${info.userCode}`);
}

async function createCredential(options: EntraAuthOptions): Promise<TokenCredential> {
  const { AzureCliCredential, DeviceCodeCredential } = await import("@azure/identity");
  if (options.mode === "cli") return new AzureCliCredential({ tenantId: options.tenantId });
  return new DeviceCodeCredential({
    tenantId: options.tenantId,
    ...(options.clientId ? { clientId: options.clientId } : {}),
    userPromptCallback: options.prompt ?? defaultPrompt,
  });
}

/** Returns a cached bearer-token provider for the Cognitive Services scope. */
export async function createEntraTokenProvider(
  options: EntraAuthOptions,
): Promise<() => Promise<string>> {
  const credential = await createCredential(options);
  let cached: AccessToken | null = null;
  return async () => {
    if (!cached || cached.expiresOnTimestamp - Date.now() < REFRESH_MARGIN_MS) {
      cached = await credential.getToken(COGNITIVE_SERVICES_SCOPE);
      if (!cached?.token) throw new Error("Entra ID sign-in did not return an access token.");
    }
    return cached.token;
  };
}
