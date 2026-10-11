import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";

import { setDatabaseSessionCookie } from "@/lib/auth/session-cookie";

test("password authentication sets the same hardened database-session cookie as NextAuth", () => {
  const response = NextResponse.json({ ok: true });
  setDatabaseSessionCookie(response, {
    sessionToken: "opaque-session-token",
    expires: new Date("2030-01-02T03:04:05.000Z"),
  });

  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /next-auth\.session-token=opaque-session-token/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.doesNotMatch(cookie, /Secure/i);
  assert.match(cookie, /Expires=Wed, 02 Jan 2030 03:04:05 GMT/);
});
