import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/reader", "/settings", "/onboarding", "/admin", "/study", "/tags", "/browse", "/lists", "/notes", "/progress", "/offline", "/import", "/teacher", "/assignments"];

const SESSION_COOKIES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

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
  matcher: ["/", "/dashboard/:path*", "/reader/:path*", "/settings/:path*", "/onboarding/:path*", "/admin/:path*", "/study/:path*", "/tags/:path*", "/browse/:path*", "/lists/:path*", "/lists", "/notes/:path*", "/notes", "/progress/:path*", "/progress", "/offline/:path*", "/offline", "/import", "/import/:path*", "/teacher", "/teacher/:path*", "/assignments", "/assignments/:path*"],
};
