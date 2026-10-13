process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { Prisma } from "@prisma/client";

let attempts = 0;
let transactionOptions: unknown[] = [];
// Number of leading attempts that hit a serializable write conflict.
let conflictAttempts = 1;
let nonRetryableError: Error | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $transaction: async (
          operation: (tx: { attempt: number }) => Promise<unknown>,
          options: unknown,
        ) => {
          attempts += 1;
          transactionOptions.push(options);
          if (nonRetryableError) throw nonRetryableError;
          if (attempts <= conflictAttempts) {
            throw new Prisma.PrismaClientKnownRequestError("write conflict", {
              code: "P2034",
              clientVersion: "test",
            });
          }
          return operation({ attempt: attempts });
        },
      },
    },
  });
});

test("runSerializableTransaction retries write conflicts at serializable isolation", async () => {
  attempts = 0;
  transactionOptions = [];
  const { runSerializableTransaction } = await import(
    "@/lib/database/serializable-transaction"
  );

  const result = await runSerializableTransaction(async (tx) =>
    (tx as unknown as { attempt: number }).attempt
  );

  assert.equal(result, 2);
  assert.equal(attempts, 2);
  assert.deepEqual(transactionOptions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ]);
});

test("runSerializableTransaction rethrows the conflict after the final attempt", async () => {
  attempts = 0;
  transactionOptions = [];
  conflictAttempts = Number.POSITIVE_INFINITY;
  const { runSerializableTransaction } = await import(
    "@/lib/database/serializable-transaction"
  );

  try {
    await assert.rejects(
      runSerializableTransaction(async () => "unreachable"),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034",
    );
    assert.equal(attempts, 3);
  } finally {
    conflictAttempts = 1;
  }
});

test("runSerializableTransaction does not retry non-conflict errors", async () => {
  attempts = 0;
  transactionOptions = [];
  nonRetryableError = new Error("constraint violated");
  const { runSerializableTransaction } = await import(
    "@/lib/database/serializable-transaction"
  );

  try {
    await assert.rejects(runSerializableTransaction(async () => "unreachable"), /constraint violated/);
    assert.equal(attempts, 1);
  } finally {
    nonRetryableError = null;
  }
});
