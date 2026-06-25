import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import { buildProviders } from "@/lib/auth-providers";
import { bootstrapFirstUser } from "@/lib/auth-bootstrap";
import { SESSION_COOKIES } from "@/lib/route-policy";

// SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"]
// Index 0 → development, index 1 → production (matches useSecureCookies posture).
const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? SESSION_COOKIES[1] : SESSION_COOKIES[0];

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
  // Secure + `__Secure-` prefixed in production. Cookie names are sourced from
  // SESSION_COOKIES in `@/lib/route-policy` so middleware and NextAuth stay in sync.
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
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
      await bootstrapFirstUser(user.id);
    },
  },
};
