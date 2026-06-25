/**
 * Auth provider registry (REF-064).
 *
 * Single module that owns:
 *  - CJS/ESM provider interop (so both Node native ESM and Next.js/SWC runtimes
 *    receive callable provider functions rather than a namespace object).
 *  - Runtime env-driven conditional provider construction (graceful: missing
 *    credentials → provider is omitted, no error thrown).
 *  - Provider metadata suitable for the sign-in UI (id + display name).
 *
 * Consumers:
 *  - `@/lib/auth` — passes the providers array to NextAuth.
 *  - `@/app/signin` — calls `getConfiguredProviders()` to render buttons.
 */

import type { NextAuthOptions } from "next-auth";
import GoogleProviderImport from "next-auth/providers/google";
import AzureADProviderImport from "next-auth/providers/azure-ad";

// Under Node native ESM (CLI/test harness) these CJS modules resolve to a
// namespace object { default: fn }; Next.js/SWC esModuleInterop masks this so
// the app works with bare default imports. Keep the interop here in one place.
const GoogleProvider = (
  GoogleProviderImport as unknown as { default?: typeof GoogleProviderImport }
).default ?? GoogleProviderImport;

const AzureADProvider = (
  AzureADProviderImport as unknown as { default?: typeof AzureADProviderImport }
).default ?? AzureADProviderImport;

/** Build the NextAuth providers array from runtime environment config. */
export function buildProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [];

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    );
  }

  if (
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET &&
    process.env.AZURE_AD_TENANT_ID
  ) {
    providers.push(
      AzureADProvider({
        clientId: process.env.AZURE_AD_CLIENT_ID,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
        tenantId: process.env.AZURE_AD_TENANT_ID,
      }),
    );
  }

  return providers;
}

export type ProviderMeta = { id: string; name: string };

/**
 * Returns lightweight provider metadata (id + display name) for the currently
 * configured providers. Safe to call in server components — does not expose
 * secrets, only the presence of configured providers.
 */
export function getConfiguredProviders(): ProviderMeta[] {
  return buildProviders().map((p) => ({ id: p.id, name: p.name }));
}
