import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: { prisma: {} },
  });
});

function retentionClient(counts = {
  registrations: 2,
  invitations: 3,
  resets: 4,
}) {
  const calls: Record<string, unknown> = {};
  return {
    calls,
    client: {
      pendingRegistration: {
        count: async (args: unknown) => {
          calls.pendingCount = args;
          return counts.registrations;
        },
        deleteMany: async (args: unknown) => {
          calls.pendingDelete = args;
          return { count: counts.registrations };
        },
      },
      accountInvitation: {
        count: async (args: unknown) => {
          calls.invitationCount = args;
          return counts.invitations;
        },
        deleteMany: async (args: unknown) => {
          calls.invitationDelete = args;
          return { count: counts.invitations };
        },
      },
      passwordCredential: {
        count: async (args: unknown) => {
          calls.resetCount = args;
          return counts.resets;
        },
        updateMany: async (args: unknown) => {
          calls.resetUpdate = args;
          return { count: counts.resets };
        },
      },
    },
  };
}

test("Account Admission retention counts expired secrets and terminal invitations", async () => {
  const { countExpiredAccountAdmissionData } = await import(
    "@/lib/account-admission/retention"
  );
  const { client, calls } = retentionClient();
  const now = new Date("2026-10-10T12:00:00.000Z");

  const count = await countExpiredAccountAdmissionData(
    30,
    client as never,
    now,
  );

  assert.equal(count, 9);
  const invitationWhere = (
    calls.invitationCount as {
      where: { updatedAt: { lt: Date }; status: { in: string[] } };
    }
  ).where;
  assert.equal(
    invitationWhere.updatedAt.lt.toISOString(),
    "2026-09-10T12:00:00.000Z",
  );
  assert.deepEqual(invitationWhere.status.in, [
    "ACCEPTED",
    "REVOKED",
    "EXPIRED",
  ]);
});

test("Account Admission retention deletes expired pending rows and clears reset tokens", async () => {
  const { pruneExpiredAccountAdmissionData } = await import(
    "@/lib/account-admission/retention"
  );
  const { client, calls } = retentionClient();
  const now = new Date("2026-10-10T12:00:00.000Z");

  const processed = await pruneExpiredAccountAdmissionData(
    30,
    client as never,
    now,
  );

  assert.equal(processed, 9);
  assert.deepEqual(
    (calls.resetUpdate as { data: unknown }).data,
    { resetTokenHash: null, resetExpiresAt: null },
  );
});
