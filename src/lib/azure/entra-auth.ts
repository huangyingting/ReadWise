/**
 * Entra ID token providers for Azure AI Services (Azure OpenAI, Speech)
 * resources, including ones with local (key) auth disabled.
 *
 * - Service principal (certificate or client secret): the app's runtime
 *   identity; works across tenants and in containers without IMDS access.
 * - Managed identity: for hosts whose containers may reach IMDS.
 * - Device code / Azure CLI: interactive operator scripts. Device code signs in
 *   once per process; the CLI reuses a persisted `az login` session.
 *
 * Tokens are cached until shortly before expiry and never logged.
 */
import type { AccessToken, DeviceCodeInfo, TokenCredential } from "@azure/identity";

export const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type EntraAuthOptions =
  | { mode: "device"; tenantId: string; clientId?: string; prompt?: (info: DeviceCodeInfo) => void }
  | { mode: "cli"; tenantId: string }
  | { mode: "certificate"; tenantId: string; clientId: string; certificatePem: string }
  | { mode: "secret"; tenantId: string; clientId: string; clientSecret: string }
  | { mode: "managed-identity"; clientId?: string };

function defaultPrompt(info: DeviceCodeInfo): void {
  console.error(`Entra ID: open ${info.verificationUri} and enter code ${info.userCode}`);
}

async function createCredential(options: EntraAuthOptions): Promise<TokenCredential> {
  const identity = await import("@azure/identity");
  switch (options.mode) {
    case "cli":
      return new identity.AzureCliCredential({ tenantId: options.tenantId });
    case "certificate":
      return new identity.ClientCertificateCredential(options.tenantId, options.clientId, {
        certificate: options.certificatePem,
      });
    case "secret":
      return new identity.ClientSecretCredential(options.tenantId, options.clientId, options.clientSecret);
    case "managed-identity":
      return options.clientId
        ? new identity.ManagedIdentityCredential({ clientId: options.clientId })
        : new identity.ManagedIdentityCredential();
    case "device":
      return new identity.DeviceCodeCredential({
        tenantId: options.tenantId,
        ...(options.clientId ? { clientId: options.clientId } : {}),
        userPromptCallback: options.prompt ?? defaultPrompt,
      });
  }
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
