/**
 * Tests for sign-in view helpers (REF-064).
 *
 * Verifies error code mapping and callbackUrl sanitization in isolation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  friendlySignInError,
  sanitizeCallbackUrl,
  SIGNIN_ERROR_MESSAGES,
} from "@/lib/signin-helpers";

// ---------------------------------------------------------------------------
// friendlySignInError
// ---------------------------------------------------------------------------

test("friendlySignInError returns null for undefined/missing code", () => {
  assert.equal(friendlySignInError(undefined), null);
  assert.equal(friendlySignInError(""), null);
});

test("friendlySignInError maps OAuthAccountNotLinked", () => {
  assert.equal(
    friendlySignInError("OAuthAccountNotLinked"),
    SIGNIN_ERROR_MESSAGES["OAuthAccountNotLinked"],
  );
});

test("friendlySignInError maps AccessDenied", () => {
  assert.equal(
    friendlySignInError("AccessDenied"),
    SIGNIN_ERROR_MESSAGES["AccessDenied"],
  );
});

test("friendlySignInError returns generic message for unknown codes", () => {
  const msg = friendlySignInError("SomeUnknownError");
  assert.ok(typeof msg === "string" && msg.length > 0);
  assert.ok(!Object.prototype.hasOwnProperty.call(SIGNIN_ERROR_MESSAGES, "SomeUnknownError"));
});

// ---------------------------------------------------------------------------
// sanitizeCallbackUrl
// ---------------------------------------------------------------------------

test("sanitizeCallbackUrl allows relative paths", () => {
  assert.equal(sanitizeCallbackUrl("/dashboard"), "/dashboard");
  assert.equal(sanitizeCallbackUrl("/reader/123"), "/reader/123");
  assert.equal(sanitizeCallbackUrl("/settings?tab=profile"), "/settings?tab=profile");
});

test("sanitizeCallbackUrl falls back to /dashboard for absolute URLs", () => {
  assert.equal(sanitizeCallbackUrl("https://evil.com"), "/dashboard");
  assert.equal(sanitizeCallbackUrl("http://localhost:3000/dashboard"), "/dashboard");
  // Protocol-relative and backslash forms resolve to another origin.
  for (const url of ["//evil.com", "//evil.com/dashboard", "/\\evil.com", "/\\/evil.com", "/\tevil.com", "/\n//evil.com"]) {
    assert.equal(sanitizeCallbackUrl(url), "/dashboard", JSON.stringify(url));
  }
  assert.equal(sanitizeCallbackUrl("/notes?q=%2F%2Fevil.com"), "/notes?q=%2F%2Fevil.com", "encoded text in a query stays a path");
});

test("sanitizeCallbackUrl falls back to /dashboard for empty or missing values", () => {
  assert.equal(sanitizeCallbackUrl(""), "/dashboard");
  assert.equal(sanitizeCallbackUrl(undefined), "/dashboard");
});
