/**
 * Unit tests for P2002 field extraction across Prisma error shapes, including
 * the driver-adapter shape production uses (fields under
 * `meta.driverAdapterError.cause.constraint`, no `meta.target`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { isUniqueConflictOn, uniqueConstraintFields } from "@/lib/database/unique-constraint";

function p2002(meta: Record<string, unknown> | undefined, code = "P2002") {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code, clientVersion: "test", meta });
}

test("reads classic meta.target arrays and index names", () => {
  assert.deepEqual(uniqueConstraintFields(p2002({ target: ["providerKey", "canonicalKey"] })), ["providerKey", "canonicalKey"]);
  assert.deepEqual(uniqueConstraintFields(p2002({ target: "CrawlCandidate_providerKey_canonicalKey_key" })), [
    "CrawlCandidate_providerKey_canonicalKey_key",
  ]);
});

test("reads driver-adapter constraint fields and index names, unquoting identifiers", () => {
  const adapter = p2002({
    modelName: "CrawlCandidate",
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: { originalCode: "23505", kind: "UniqueConstraintViolation", constraint: { fields: ['"providerKey"', '"canonicalKey"'] } },
    },
  });
  assert.deepEqual(uniqueConstraintFields(adapter), ["providerKey", "canonicalKey"]);
  assert.equal(isUniqueConflictOn(adapter, "canonicalKey"), true);
  assert.equal(isUniqueConflictOn(adapter, "provisionalKey"), false);

  const byIndex = p2002({ driverAdapterError: { cause: { constraint: { index: "CrawlCandidate_provisionalKey_key" } } } });
  assert.equal(isUniqueConflictOn(byIndex, "provisionalKey"), true);
});

test("non-P2002 and foreign errors are not unique conflicts", () => {
  assert.equal(uniqueConstraintFields(p2002({ target: ["x"] }, "P2025")), null);
  assert.equal(uniqueConstraintFields(new Error("boom")), null);
  assert.deepEqual(uniqueConstraintFields(p2002(undefined)), []);
  assert.equal(isUniqueConflictOn(new Error("canonicalKey"), "canonicalKey"), false);
});
