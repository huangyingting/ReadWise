import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GoogleProviderImport from "next-auth/providers/google";
import AzureADProviderImport from "next-auth/providers/azure-ad";
// Under Node native ESM (CLI harness) these CJS modules resolve to a namespace
// object { default: fn }; Next.js/SWC esModuleInterop masks this so the app
// works with bare default imports. Use the interop pattern so both runtimes
// get the callable function.
const GoogleProvider = (GoogleProviderImport as unknown as { default?: typeof GoogleProviderImport }).default ?? GoogleProviderImport;
const AzureADProvider = (AzureADProviderImport as unknown as { default?: typeof AzureADProviderImport }).default ?? AzureADProviderImport;
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

function buildProviders() {
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

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: buildProviders(),
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  // Explicit, production-safe cookie posture (RW-028). The session cookie is
  // HttpOnly (no JS access), SameSite=Lax (sent on top-level navigations but
  // withheld from cross-site sub-requests — a baseline CSRF mitigation), and
  // Secure + `__Secure-` prefixed in production. The names match the
  // SESSION_COOKIES list in `middleware.ts`.
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as { role?: Role }).role ?? "Reader";
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      const userCount = await prisma.user.count();
      if (userCount === 1) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "Admin" },
        });
      }
    },
  },
};
