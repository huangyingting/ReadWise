import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { buildProviders } from "@/lib/auth/providers";
import { assignSessionIdentity } from "@/lib/auth/identity";
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/lib/account-admission/session";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/session-cookie";
import { authorizeSocialSignIn } from "@/lib/account-admission/social";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function createAuthAdapter(): Adapter {
  const adapter = PrismaAdapter(prisma) as Adapter;
  return {
    ...adapter,
    async deleteSession(sessionToken) {
      await prisma.session.deleteMany({ where: { sessionToken } });
    },
  };
}

const authCallbacks: NonNullable<NextAuthOptions["callbacks"]> = {
  async signIn({ account, profile }) {
    return authorizeSocialSignIn({ account, profile });
  },
  async session({ session, user }) {
    return assignSessionIdentity(session, user);
  },
};

export const authOptions: NextAuthOptions = {
  adapter: createAuthAdapter(),
  providers: buildProviders(),
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  // Explicit, production-safe cookie posture (RW-028). The session cookie is
  // HttpOnly (no JS access), SameSite=Lax (sent on top-level navigations but
  // withheld from cross-site sub-requests — a baseline CSRF mitigation), and
  // Secure + `__Secure-` prefixed in production. Cookie names are sourced from
  // SESSION_COOKIES in `@/lib/route-policy` so middleware and NextAuth stay in sync.
  useSecureCookies: IS_PRODUCTION,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: SESSION_COOKIE_OPTIONS,
    },
  },
  pages: {
    signIn: "/signin",
  },
  callbacks: authCallbacks,
};
