import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let adminCount = 0;
let existingUser: { id: string; email: string; emailVerified: Date | null } | null;
let createdUser: Record<string, unknown> | null;
let updatedUser: Record<string, unknown> | null;
let upsertedCredential: Record<string, unknown> | null;

const tx = {
  user: {
    count: async () => adminCount,
    findUnique: async () => existingUser,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdUser = data;
      return { id: "created-admin", ...data };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updatedUser = data;
      return { id: existingUser?.id ?? "existing-admin", ...data };
    },
  },
  passwordCredential: {
    upsert: async (args: Record<string, unknown>) => {
      upsertedCredential = args;
      return {};
    },
  },
};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $transaction: async (operation: (client: typeof tx) => Promise<unknown>) =>
          operation(tx),
      },
    },
  });
  mock.module("@/lib/database/serializable-transaction", {
    namedExports: {
      runSerializableTransaction: async (
        operation: (client: typeof tx) => Promise<unknown>,
      ) => operation(tx),
    },
  });
});

beforeEach(() => {
  adminCount = 0;
  existingUser = null;
  createdUser = null;
  updatedUser = null;
  upsertedCredential = null;
});

test("bootstrapAdmin creates an explicit verified Admin with a Password Credential", async () => {
  const { bootstrapAdmin } = await import("@/lib/auth/bootstrap");
  const result = await bootstrapAdmin({
    email: " Admin@Example.com ",
    password: "correct horse battery staple",
  });

  assert.equal(result.id, "created-admin");
  assert.equal(createdUser?.email, "admin@example.com");
  assert.equal(createdUser?.role, "Admin");
  assert.ok(createdUser?.emailVerified instanceof Date);
  const nested = createdUser?.passwordCredential as {
    create?: { passwordHash?: string };
  };
  assert.match(nested.create?.passwordHash ?? "", /^scrypt\$/);
});

test("bootstrapAdmin can recover an existing user only when no Admin exists", async () => {
  existingUser = {
    id: "reader-1",
    email: "reader@example.com",
    emailVerified: null,
  };
  const { bootstrapAdmin } = await import("@/lib/auth/bootstrap");
  const result = await bootstrapAdmin({
    email: "reader@example.com",
    password: "correct horse battery staple",
  });

  assert.equal(result.id, "reader-1");
  assert.equal(updatedUser?.role, "Admin");
  assert.ok(updatedUser?.emailVerified instanceof Date);
  assert.ok(upsertedCredential);
});

test("bootstrapAdmin refuses to change access once an Admin exists", async () => {
  adminCount = 1;
  const { bootstrapAdmin } = await import("@/lib/auth/bootstrap");

  await assert.rejects(
    bootstrapAdmin({
      email: "other@example.com",
      password: "correct horse battery staple",
    }),
    /already has an administrator/i,
  );
  assert.equal(createdUser, null);
  assert.equal(updatedUser, null);
});
