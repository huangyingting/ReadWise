/**
 * Race-only branches of Account Admission: outcomes that need a concurrent
 * writer between a read and the guarded write, which a real database cannot
 * produce deterministically. Prisma and the serializable runner are scripted.
 */
import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import { Prisma } from "@prisma/client";

type Invitation = {
  id: string;
  email: string;
  normalizedEmail: string;
  status: string;
  expiresAt: Date;
};

const future = () => new Date(Date.now() + 60_000);

function pendingInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv-1",
    email: "reader@example.test",
    normalizedEmail: "reader@example.test",
    status: "PENDING",
    expiresAt: future(),
    ...overrides,
  };
}

// Each findUnique call shifts the next scripted result; updateMany returns `updateCount`.
let findResults: Array<Invitation | null> = [];
let updateCount = 1;
let transactionError: unknown = null;

const accountInvitation = {
  findUnique: async () => findResults.shift() ?? null,
  updateMany: async () => ({ count: updateCount }),
};

const tx = {
  accountInvitation,
  user: {
    findUnique: async () => null,
    create: async ({ data }: { data: { email: string } }) => ({
      id: "user-1",
      role: "Reader",
      email: data.email,
    }),
  },
};

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: { accountInvitation } } });
  mock.module("@/lib/database/serializable-transaction", {
    namedExports: {
      runSerializableTransaction: async (operation: (client: typeof tx) => Promise<unknown>) => {
        if (transactionError) throw transactionError;
        return operation(tx);
      },
    },
  });
});

beforeEach(() => {
  findResults = [];
  updateCount = 1;
  transactionError = null;
});

async function rejectsWithCode(action: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

test("a unique-constraint race on invitation creation reports the existing grant", async () => {
  const { createAccountInvitation } = await import("@/lib/account-admission/invitations");

  transactionError = new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
  });
  await rejectsWithCode(
    createAccountInvitation({ email: "reader@example.test", invitedById: "admin-1" }),
    "invitation_exists",
  );

  transactionError = new Error("database offline");
  await assert.rejects(
    createAccountInvitation({ email: "reader@example.test", invitedById: "admin-1" }),
    /database offline/,
  );
});

test("revocation reports a concurrent change and a vanished invitation", async () => {
  const { revokeAccountInvitation } = await import("@/lib/account-admission/invitations");

  findResults = [pendingInvitation()];
  updateCount = 0;
  await rejectsWithCode(revokeAccountInvitation("inv-1"), "claim_conflict");

  findResults = [pendingInvitation(), null];
  updateCount = 1;
  await rejectsWithCode(revokeAccountInvitation("inv-1"), "not_found");
});

test("rotation reports a concurrent change and a vanished invitation", async () => {
  const { rotateAccountInvitation } = await import("@/lib/account-admission/invitations");

  findResults = [pendingInvitation()];
  updateCount = 0;
  await rejectsWithCode(rotateAccountInvitation("inv-1"), "claim_conflict");

  findResults = [pendingInvitation(), null];
  updateCount = 1;
  await rejectsWithCode(rotateAccountInvitation("inv-1"), "not_found");
});

test("invitation registration loses cleanly when another claim wins first", async () => {
  const { registerWithInvitation } = await import("@/lib/account-admission/registration");

  findResults = [pendingInvitation()];
  updateCount = 0;
  await rejectsWithCode(
    registerWithInvitation({
      token: "token",
      email: "reader@example.test",
      password: "correct horse battery staple",
    }),
    "claim_conflict",
  );
});
