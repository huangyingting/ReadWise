import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIES } from "@/lib/route-policy";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";
import { normalizeAccountEmail, verifiedProviderEmail } from "./policy";

type SocialAccount = {
  provider?: string | null;
  providerAccountId?: string | null;
};

async function currentSessionUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const cookieStore = await cookies();
  const cookieNames = [
    SESSION_COOKIE_NAME,
    ...SESSION_COOKIES.filter((name) => name !== SESSION_COOKIE_NAME),
  ];
  const sessionToken = cookieNames
    .map((name) => cookieStore.get(name)?.value)
    .find((value): value is string => Boolean(value));
  if (!sessionToken) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    select: {
      user: {
        select: { id: true, email: true },
      },
    },
  });
  return session?.user ?? null;
}

export async function authorizeSocialSignIn(input: {
  account: SocialAccount | null | undefined;
  profile: unknown;
}): Promise<boolean> {
  const provider = input.account?.provider;
  const providerAccountId = input.account?.providerAccountId;
  if (!provider || !providerAccountId) return false;

  const verifiedEmail = verifiedProviderEmail(provider, input.profile);
  if (!verifiedEmail) return false;

  const linked = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    select: { userId: true },
  });
  if (linked) return true;

  const sessionUser = await currentSessionUser();
  if (!sessionUser?.email) return false;
  return normalizeAccountEmail(sessionUser.email) === verifiedEmail;
}
