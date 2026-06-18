import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function requireSession(callbackUrl: string): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return session;
}

export async function requireAdmin(callbackUrl: string): Promise<Session> {
  const session = await requireSession(callbackUrl);
  if (session.user.role !== "Admin") {
    redirect("/forbidden");
  }
  return session;
}
