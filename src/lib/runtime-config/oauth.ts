/**
 * OAuth provider configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { defineFeatureConfig, envValue, type FeatureConfig } from "@/lib/runtime-config/env";

// ---------------------------------------------------------------------------
// Google OAuth2
// ---------------------------------------------------------------------------

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

/** Google OAuth2 config; null when either credential is absent. */
export const googleOAuthConfig: FeatureConfig<GoogleOAuthConfig> = defineFeatureConfig(() => {
  const clientId = envValue("GOOGLE_CLIENT_ID");
  const clientSecret = envValue("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
});

// ---------------------------------------------------------------------------
// Azure AD OAuth2
// ---------------------------------------------------------------------------

export type AzureAdOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

/** Azure AD OAuth2 config; null when any credential is absent. */
export const azureAdOAuthConfig: FeatureConfig<AzureAdOAuthConfig> = defineFeatureConfig(() => {
  const clientId = envValue("AZURE_AD_CLIENT_ID");
  const clientSecret = envValue("AZURE_AD_CLIENT_SECRET");
  const tenantId = envValue("AZURE_AD_TENANT_ID");
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
});
