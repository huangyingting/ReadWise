/**
 * Auth provider registry (REF-064).
 *
 * Single module that owns:
 *  - CJS/ESM provider interop
 *  - Runtime env-driven conditional provider construction (graceful fallback:
 *    missing credentials => provider omitted, no throw)
 *  - Lightweight provider metadata for sign-in UI rendering
 */
import type { NextAuthOptions } from "next-auth";
import GoogleProviderImport from "next-auth/providers/google";
import AzureADProviderImport from "next-auth/providers/azure-ad";
import { googleOAuthConfig, azureAdOAuthConfig } from "@/lib/runtime-config/oauth";

type DefaultInterop<T> = { default: T };

function hasDefaultInterop<T>(provider: T | DefaultInterop<T>): provider is DefaultInterop<T> {
  return typeof provider === "object" && provider !== null && "default" in provider;
}

function unwrapProvider<T>(provider: T | DefaultInterop<T>): T {
  return hasDefaultInterop(provider) ? provider.default : provider;
}

const GoogleProvider = unwrapProvider(GoogleProviderImport);
const AzureADProvider = unwrapProvider(AzureADProviderImport);

/** Build the NextAuth providers array from runtime environment config. */
export function buildProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [];

  const google = googleOAuthConfig.get();
  if (google) {
    providers.push(
      GoogleProvider({
        clientId: google.clientId,
        clientSecret: google.clientSecret,
      }),
    );
  }

  const azureAd = azureAdOAuthConfig.get();
  if (azureAd) {
    providers.push(
      AzureADProvider({
        clientId: azureAd.clientId,
        clientSecret: azureAd.clientSecret,
        tenantId: azureAd.tenantId,
      }),
    );
  }

  return providers;
}

export type ProviderMeta = { id: string; name: string };

/**
 * Returns lightweight provider metadata (id + display name) for currently
 * configured providers. Safe to call in server components — secrets are not
 * exposed, only provider presence.
 */
export function getConfiguredProviders(): ProviderMeta[] {
  return buildProviders().map((provider) => ({ id: provider.id, name: provider.name }));
}
