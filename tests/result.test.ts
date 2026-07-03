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

async function assertDomainError(
  importName: "notFound" | "validationError" | "conflict" | "forbidden" | "unavailable" | "unexpected",
  args: [] | [string],
  expected: { status: number; error: string },
) {
  const resultModule = await import("@/lib/result");
  const factory = resultModule[importName] as (message?: string) => DomainResult;
  const result = factory(...args);
  assert.equal(result.ok, false);
  assert.equal(result.status, expected.status);
  assert.equal(result.error, expected.error);
}

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
  await assertDomainError("notFound", [], { status: 404, error: "Not found" });
});

test("notFound(message) uses the supplied message", async () => {
  await assertDomainError("notFound", ["List not found"], { status: 404, error: "List not found" });
});

test("validationError() returns 400", async () => {
  await assertDomainError("validationError", ["Title cannot be empty"], {
    status: 400,
    error: "Title cannot be empty",
  });
});

test("conflict() returns 409", async () => {
  await assertDomainError("conflict", ["Cannot delete the default list"], {
    status: 409,
    error: "Cannot delete the default list",
  });
});

test("forbidden() returns 403 with default message", async () => {
  await assertDomainError("forbidden", [], { status: 403, error: "Forbidden" });
});

test("forbidden(message) uses the supplied message", async () => {
  await assertDomainError("forbidden", ["Not your resource"], {
    status: 403,
    error: "Not your resource",
  });
});

test("unavailable() returns 503 with default message", async () => {
  await assertDomainError("unavailable", [], { status: 503, error: "Service unavailable" });
});

test("unexpected() returns 500 with default message", async () => {
  await assertDomainError("unexpected", [], { status: 500, error: "Unexpected error" });
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
