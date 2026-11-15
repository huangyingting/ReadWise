/**
 * Azure AI Services authentication settings (server-only).
 *
 * Azure OpenAI and Speech each choose an auth mode independently:
 *   AZURE_OPENAI_AUTH / AZURE_SPEECH_AUTH = "key" (default) | "entra"
 *
 * "entra" uses one shared runtime identity for both services:
 *   - service principal: AZURE_AI_TENANT_ID + AZURE_AI_CLIENT_ID and either
 *     AZURE_AI_CLIENT_CERTIFICATE (PEM with private key, base64-encoded or
 *     with literal "\n" escapes) or AZURE_AI_CLIENT_SECRET;
 *   - managed identity: AZURE_AI_USE_MANAGED_IDENTITY=true, with an optional
 *     user-assigned AZURE_AI_CLIENT_ID. Only for hosts whose containers may
 *     reach IMDS (WebStack app containers cannot).
 *
 * IMPORTANT: never import from a Client Component.
 */
import type { EntraAuthOptions } from "@/lib/azure/entra-auth";
import { defineFeatureConfig, envValue, type FeatureConfig } from "./env";

export type AzureAuthMode = "key" | "entra";
export type AzureAuthModeEnv = "AZURE_OPENAI_AUTH" | "AZURE_SPEECH_AUTH";

/** The configured auth mode for one service; anything but "entra" means key auth. */
export function azureAuthMode(name: AzureAuthModeEnv): AzureAuthMode {
  return envValue(name)?.toLowerCase() === "entra" ? "entra" : "key";
}

/** Runtime identity options for AI services; excludes interactive operator modes. */
export type AiServicesIdentity = Extract<
  EntraAuthOptions,
  { mode: "certificate" | "secret" | "managed-identity" }
>;

/**
 * Accepts a PEM given directly (with real or "\n"-escaped newlines) or
 * base64-encoded, which keeps it on one line in env files. Returns null unless
 * the result contains a private key.
 */
export function decodeCertificatePem(value: string): string | null {
  const pem = value.includes("-----BEGIN")
    ? value.replace(/\\n/g, "\n")
    : Buffer.from(value, "base64").toString("utf8");
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem) ? pem : null;
}

/** The shared Entra identity for Azure AI Services, or null when incomplete. */
export const aiServicesIdentity: FeatureConfig<AiServicesIdentity> = defineFeatureConfig(() => {
  const clientId = envValue("AZURE_AI_CLIENT_ID");
  if (envValue("AZURE_AI_USE_MANAGED_IDENTITY")?.toLowerCase() === "true") {
    return clientId ? { mode: "managed-identity", clientId } : { mode: "managed-identity" };
  }
  const tenantId = envValue("AZURE_AI_TENANT_ID");
  if (!tenantId || !clientId) return null;
  const certificate = envValue("AZURE_AI_CLIENT_CERTIFICATE");
  if (certificate) {
    const certificatePem = decodeCertificatePem(certificate);
    return certificatePem ? { mode: "certificate", tenantId, clientId, certificatePem } : null;
  }
  const clientSecret = envValue("AZURE_AI_CLIENT_SECRET");
  return clientSecret ? { mode: "secret", tenantId, clientId, clientSecret } : null;
});

/**
 * Env vars an "entra" service needs for its identity, for readiness reporting.
 * The credential slot names whichever of certificate/secret is in use.
 */
export function aiServicesIdentityEnv(): string[] {
  if (envValue("AZURE_AI_USE_MANAGED_IDENTITY")?.toLowerCase() === "true") {
    return ["AZURE_AI_USE_MANAGED_IDENTITY"];
  }
  const credential =
    !envValue("AZURE_AI_CLIENT_CERTIFICATE") && envValue("AZURE_AI_CLIENT_SECRET")
      ? "AZURE_AI_CLIENT_SECRET"
      : "AZURE_AI_CLIENT_CERTIFICATE";
  return ["AZURE_AI_TENANT_ID", "AZURE_AI_CLIENT_ID", credential];
}
