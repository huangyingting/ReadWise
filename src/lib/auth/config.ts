import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIES } from "@/lib/route-policy";
import { buildProviders } from "@/lib/auth/providers";
import { bootstrapFirstUser } from "@/lib/auth/bootstrap";
import { assignSessionIdentity } from "@/lib/auth/identity";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

// SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"]
// Index 0 → development, index 1 → production (matches useSecureCookies posture).
const SESSION_COOKIE_NAME = IS_PRODUCTION ? SESSION_COOKIES[1] : SESSION_COOKIES[0];

function verifiedGoogleEmail(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;

  const googleProfile = profile as Record<string, unknown>;
  if (googleProfile.email_verified !== true || typeof googleProfile.email !== "string") {
    return null;
  }

  const email = googleProfile.email.trim().toLowerCase();
  return email || null;
}

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
    if (account?.provider !== "google") return true;

    const email = verifiedGoogleEmail(profile);
    if (!email) return false;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return existingUser !== null;
  },
  async session({ session, user }) {
    return assignSessionIdentity(session, user);
  },
};

const authEvents: NonNullable<NextAuthOptions["events"]> = {
  async createUser({ user }) {
    await bootstrapFirstUser(user.id);
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
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PRODUCTION,
      },
    },
  },
  pages: {
    signIn: "/signin",
  },
  callbacks: authCallbacks,
  events: authEvents,
};
