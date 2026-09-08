process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { Prisma } from "@prisma/client";

let attempts = 0;
let transactionOptions: unknown[] = [];

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
          if (attempts === 1) {
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
