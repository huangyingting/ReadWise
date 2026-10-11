import type { NextResponse } from "next/server";
import { SESSION_COOKIES } from "@/lib/route-policy";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export const SESSION_COOKIE_NAME = IS_PRODUCTION
  ? SESSION_COOKIES[1]
  : SESSION_COOKIES[0];

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: IS_PRODUCTION,
};

export function setDatabaseSessionCookie(
  response: NextResponse,
  session: { sessionToken: string; expires: Date },
): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.sessionToken,
    expires: session.expires,
    ...SESSION_COOKIE_OPTIONS,
  });
}
