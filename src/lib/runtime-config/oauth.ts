/**
 * OAuth provider configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { defineFeatureConfig, envValue, type FeatureConfig } from "@/lib/runtime-config/env";

const GOOGLE_OAUTH_ENV = {
  clientId: "GOOGLE_CLIENT_ID",
  clientSecret: "GOOGLE_CLIENT_SECRET",
} as const;

const AZURE_AD_OAUTH_ENV = {
  clientId: "AZURE_AD_CLIENT_ID",
  clientSecret: "AZURE_AD_CLIENT_SECRET",
  tenantId: "AZURE_AD_TENANT_ID",
} as const;

// ---------------------------------------------------------------------------
// Google OAuth2
// ---------------------------------------------------------------------------

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

/** Google OAuth2 config; null when either credential is absent. */
export const googleOAuthConfig: FeatureConfig<GoogleOAuthConfig> = defineFeatureConfig(readGoogleOAuthConfig);

function readGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = envValue(GOOGLE_OAUTH_ENV.clientId);
  const clientSecret = envValue(GOOGLE_OAUTH_ENV.clientSecret);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Azure AD OAuth2
// ---------------------------------------------------------------------------

export type AzureAdOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

/** Azure AD OAuth2 config; null when any credential is absent. */
export const azureAdOAuthConfig: FeatureConfig<AzureAdOAuthConfig> = defineFeatureConfig(readAzureAdOAuthConfig);

function readAzureAdOAuthConfig(): AzureAdOAuthConfig | null {
  const clientId = envValue(AZURE_AD_OAUTH_ENV.clientId);
  const clientSecret = envValue(AZURE_AD_OAUTH_ENV.clientSecret);
  const tenantId = envValue(AZURE_AD_OAUTH_ENV.tenantId);
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}
