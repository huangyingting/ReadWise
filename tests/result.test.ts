/**
 * Tests for the domain result/error contract library (REF-082).
 *
 * Covers constructors, HTTP status codes, and the throwIfFailed route helper.
 * @/lib/api-handler is mocked so ApiError is available without the full
 * Next.js runtime.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { DomainResult } from "@/lib/result";

// ── ApiError stub ──────────────────────────────────────────────────────────

class StubApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

before(() => {
  mock.module("@/lib/api-handler", {
    namedExports: { ApiError: StubApiError },
  });
});

// ── Constructors ───────────────────────────────────────────────────────────

test("ok() returns { ok: true } with no extra fields", async () => {
  const { ok } = await import("@/lib/result");
  const result = ok();
  assert.deepEqual(result, { ok: true });
});

test("ok(data) merges data into the success shape", async () => {
  const { ok } = await import("@/lib/result");
  const result = ok({ bookmarked: true, count: 3 });
  assert.deepEqual(result, { ok: true, bookmarked: true, count: 3 });
});

test("notFound() returns 404 with default message", async () => {
  const { notFound } = await import("@/lib/result");
  const result = notFound();
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, "Not found");
});

test("notFound(message) uses the supplied message", async () => {
  const { notFound } = await import("@/lib/result");
  const result = notFound("List not found");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, "List not found");
});

test("validationError() returns 400", async () => {
  const { validationError } = await import("@/lib/result");
  const result = validationError("Title cannot be empty");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, "Title cannot be empty");
});

test("conflict() returns 409", async () => {
  const { conflict } = await import("@/lib/result");
  const result = conflict("Cannot delete the default list");
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.error, "Cannot delete the default list");
});

test("forbidden() returns 403 with default message", async () => {
  const { forbidden } = await import("@/lib/result");
  const result = forbidden();
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, "Forbidden");
});

test("forbidden(message) uses the supplied message", async () => {
  const { forbidden } = await import("@/lib/result");
  const result = forbidden("Not your resource");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, "Not your resource");
});

test("unavailable() returns 503 with default message", async () => {
  const { unavailable } = await import("@/lib/result");
  const result = unavailable();
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error, "Service unavailable");
});

test("unexpected() returns 500 with default message", async () => {
  const { unexpected } = await import("@/lib/result");
  const result = unexpected();
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.error, "Unexpected error");
});

// ── throwIfFailed ──────────────────────────────────────────────────────────

test("throwIfFailed does not throw for a successful result", async () => {
  const { ok, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult<{ value: number }> = ok({ value: 42 });
  assert.doesNotThrow(() => throwIfFailed(result));
});

test("throwIfFailed throws ApiError with 404 on notFound", async () => {
  const { notFound, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult = notFound("Item not found");
  assert.throws(
    () => throwIfFailed(result),
    (err: unknown) => {
      assert.ok(err instanceof StubApiError, "should throw StubApiError");
      assert.equal(err.status, 404);
      assert.equal(err.message, "Item not found");
      return true;
    },
  );
});

test("throwIfFailed throws ApiError with 409 on conflict", async () => {
  const { conflict, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult = conflict("Cannot remove the last admin");
  assert.throws(
    () => throwIfFailed(result),
    (err: unknown) => {
      assert.ok(err instanceof StubApiError);
      assert.equal(err.status, 409);
      assert.equal(err.message, "Cannot remove the last admin");
      return true;
    },
  );
});

test("throwIfFailed throws ApiError with 400 on validationError", async () => {
  const { validationError, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult = validationError("Name is required");
  assert.throws(
    () => throwIfFailed(result),
    (err: unknown) => {
      assert.ok(err instanceof StubApiError);
      assert.equal(err.status, 400);
      assert.equal(err.message, "Name is required");
      return true;
    },
  );
});

test("throwIfFailed throws ApiError with 403 on forbidden", async () => {
  const { forbidden, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult = forbidden("Not allowed");
  assert.throws(
    () => throwIfFailed(result),
    (err: unknown) => {
      assert.ok(err instanceof StubApiError);
      assert.equal(err.status, 403);
      return true;
    },
  );
});

test("throwIfFailed throws ApiError with 503 on unavailable", async () => {
  const { unavailable, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult = unavailable();
  assert.throws(
    () => throwIfFailed(result),
    (err: unknown) => {
      assert.ok(err instanceof StubApiError);
      assert.equal(err.status, 503);
      return true;
    },
  );
});

test("throwIfFailed throws ApiError with 500 on unexpected", async () => {
  const { unexpected, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult = unexpected("Something broke");
  assert.throws(
    () => throwIfFailed(result),
    (err: unknown) => {
      assert.ok(err instanceof StubApiError);
      assert.equal(err.status, 500);
      assert.equal(err.message, "Something broke");
      return true;
    },
  );
});

test("throwIfFailed passes through for a success result with payload", async () => {
  const { ok, throwIfFailed } = await import("@/lib/result");
  const result: DomainResult<{ list: { id: string; name: string } }> = ok({
    list: { id: "l1", name: "Saved" },
  });
  // Must not throw — the ok branch passes through cleanly.
  assert.doesNotThrow(() => throwIfFailed(result));
  // The payload is still accessible after the call (runtime check).
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.list.id, "l1");
    assert.equal(result.list.name, "Saved");
  }
});
