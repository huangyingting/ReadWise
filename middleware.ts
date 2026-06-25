import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PROTECTED_PREFIXES,
  SESSION_COOKIES,
  MIDDLEWARE_MATCHER,
} from "@/lib/route-policy";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Redirect authenticated users away from the landing page to the dashboard.
  if (pathname === "/") {
    const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (hasSession) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/signin", req.url);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: MIDDLEWARE_MATCHER,
};
