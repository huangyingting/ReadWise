import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PROTECTED_PREFIXES,
  SESSION_COOKIES,
} from "@/lib/route-policy";
import { defaultLandingPath } from "@/lib/learner-landing";

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => req.cookies.has(name));
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Redirect authenticated users away from the landing page to their default
  // landing target. When Today Session is enabled this is `/today`; otherwise it
  // stays `/dashboard` (unchanged). Role is not available at the edge, so the
  // root redirect uses the feature-flag default; admins keep direct access to
  // `/dashboard` and `/admin`.
  if (pathname === "/") {
    if (hasSessionCookie(req)) {
      return NextResponse.redirect(new URL(defaultLandingPath(), req.url));
    }
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (hasSessionCookie(req)) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/signin", req.url);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/today",
    "/today/:path*",
    "/reader/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
    "/study/:path*",
    "/tags/:path*",
    "/browse/:path*",
    "/lists/:path*",
    "/lists",
    "/notes/:path*",
    "/notes",
    "/progress/:path*",
    "/progress",
    "/offline/:path*",
    "/offline",
    "/import",
    "/import/:path*",
    "/teacher",
    "/teacher/:path*",
    "/assignments",
    "/assignments/:path*",
    "/series",
    "/series/:path*",
  ],
};
