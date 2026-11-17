/**
 * Unit tests for classroom join codes (#1309): classroom/join-code-format.ts
 * and classroom/join-codes.ts.
 *
 * Covers code format/normalization, status derivation and the teacher view,
 * rotate (create vs replace, expiry, collision retry, in-transaction audit),
 * disable (state change vs repeat vs missing), and every redemption branch
 * (format, unknown, archived, already-member, inactive, claim retry, org
 * membership creation, duplicate-join race, contention) against a mocked
 * Prisma. Real-database concurrency is covered in
 * tests/db/classroom-join-codes.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  normalizeJoinCode,
} from "@/lib/classroom/join-code-format";

const NOW = new Date("2026-11-17T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  classroomId: string;
  code: string;
  createdById: string | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "jc-1",
    classroomId: "class-1",
    code: "ABCD2345",
    createdById: "teacher-1",
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    disabledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const CLASSROOM = { id: "class-1", name: "Period 3", orgId: "org-1", archivedAt: null as Date | null };

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function auditInput(label: string) {
  return { req: new Request("http://test"), action: label, targetType: "classroom", targetId: "class-1" };
}

// ---- mutable stub state ----------------------------------------------------

let existingRow: Row | null = null;
let upsertErrors: unknown[] = [];
let upsertCalls: Array<Record<string, unknown>> = [];
let disableUpdateCount = 0;
let disableRowCount = 0;
let disableCalls: Array<Record<string, unknown>> = [];
let lookups: Array<(Row & { classroom: typeof CLASSROOM }) | null> = [];
let classroomMember: { id: string } | null = null;
let claimCounts: number[] = [];
let claimCalls: Array<Record<string, unknown>> = [];
let orgMembership: { id: string } | null = null;
let membershipCreates: Array<Record<string, unknown>> = [];
let classroomMembershipCreates: Array<Record<string, unknown>> = [];
let classroomMembershipCreateErrors: unknown[] = [];
let findUniqueCalls: Array<Record<string, unknown>> = [];
let auditCalls: Array<{ action: string; client: unknown }> = [];
let transactionClient: Record<string, unknown> = {};

before(() => {
  const client: Record<string, unknown> = {
    classroomJoinCode: {
      findUnique: async (args: { where: Record<string, unknown>; select?: unknown }) => {
        findUniqueCalls.push(args);
        if ("classroomId" in args.where) {
          return args.select ? (existingRow ? { id: existingRow.id } : null) : existingRow;
        }
        return lookups.length > 1 ? lookups.shift() : lookups[0] ?? null;
      },
      upsert: async (args: Record<string, unknown>) => {
        upsertCalls.push(args);
        const error = upsertErrors.shift();
        if (error) throw error;
        return row({ ...(args.update as Partial<Row>), id: "jc-1" });
      },
      updateMany: async (args: { where: Record<string, unknown> }) => {
        if ("code" in args.where) {
          claimCalls.push(args);
          return { count: claimCounts.length > 0 ? claimCounts.shift() : 1 };
        }
        disableCalls.push(args);
        return { count: disableUpdateCount };
      },
      count: async () => disableRowCount,
    },
    classroomMembership: {
      findUnique: async () => classroomMember,
      create: async (args: Record<string, unknown>) => {
        const error = classroomMembershipCreateErrors.shift();
        if (error) {
          // The concurrent join that won is visible on the retry.
          classroomMember = { id: "cm-race" };
          throw error;
        }
        classroomMembershipCreates.push(args);
        return { id: "cm-1" };
      },
    },
    membership: {
      findUnique: async () => orgMembership,
      create: async (args: Record<string, unknown>) => {
        membershipCreates.push(args);
        return { id: "m-1" };
      },
    },
  };
  transactionClient = { ...client, isTransaction: true };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(transactionClient);
  mock.module("@/lib/prisma", { namedExports: { prisma: client } });
  mock.module("@/lib/security/audit", {
    namedExports: {
      recordAuditFromRequest: async (input: { action: string }, auditClient: unknown) => {
        auditCalls.push({ action: input.action, client: auditClient });
      },
    },
  });
});

beforeEach(() => {
  existingRow = null;
  upsertErrors = [];
  upsertCalls = [];
  disableUpdateCount = 0;
  disableRowCount = 0;
  disableCalls = [];
  lookups = [{ ...row(), classroom: { ...CLASSROOM } }];
  classroomMember = null;
  claimCounts = [];
  claimCalls = [];
  orgMembership = null;
  membershipCreates = [];
  classroomMembershipCreates = [];
  classroomMembershipCreateErrors = [];
  findUniqueCalls = [];
  auditCalls = [];
});

async function load() {
  return import("@/lib/classroom/join-codes");
}

function sequence(values: number[]) {
  let index = 0;
  return (max: number) => {
    const value = values[index++ % values.length] ?? 0;
    assert.ok(value < max);
    return value;
  };
}

// ---- format helpers --------------------------------------------------------

test("generateJoinCode draws JOIN_CODE_LENGTH characters from the unambiguous alphabet", async () => {
  const { generateJoinCode } = await load();
  assert.equal(generateJoinCode(sequence([0])), "A".repeat(JOIN_CODE_LENGTH));
  assert.equal(generateJoinCode(sequence([30, 0, 1, 2, 3, 4, 5, 6])), "9ABCDEFG");
  assert.doesNotMatch(JOIN_CODE_ALPHABET, /[0O1IL]/);

  const random = generateJoinCode();
  assert.equal(random.length, JOIN_CODE_LENGTH);
  assert.ok([...random].every((char) => JOIN_CODE_ALPHABET.includes(char)));
});

test("normalizeJoinCode accepts case, spaces, and hyphens but rejects ambiguous input", () => {
  assert.equal(normalizeJoinCode("abcd-2345"), "ABCD2345");
  assert.equal(normalizeJoinCode(" ABCD 2345 "), "ABCD2345");
  assert.equal(normalizeJoinCode("AB-CD--23 45"), "ABCD2345");
  for (const invalid of ["", "ABCD234", "ABCD23456", "ABCD-2340", "OBCD2345", "ABCD!345", "ILLL2345"]) {
    assert.equal(normalizeJoinCode(invalid), null, invalid);
  }
});

test("formatJoinCode splits the code for display", () => {
  assert.equal(formatJoinCode("ABCD2345"), "ABCD-2345");
});

test("joinCodeStatus orders disabled, expired, exhausted, active", async () => {
  const { joinCodeStatus } = await load();
  const past = new Date(NOW.getTime() - 1);
  const future = new Date(NOW.getTime() + DAY_MS);
  assert.equal(joinCodeStatus(row({ disabledAt: NOW, expiresAt: past, maxUses: 1, useCount: 1 }), NOW), "disabled");
  assert.equal(joinCodeStatus(row({ expiresAt: past, maxUses: 1, useCount: 1 }), NOW), "expired");
  assert.equal(joinCodeStatus(row({ expiresAt: NOW }), NOW), "expired");
  assert.equal(joinCodeStatus(row({ expiresAt: future, maxUses: 2, useCount: 2 }), NOW), "exhausted");
  assert.equal(joinCodeStatus(row({ expiresAt: future, maxUses: 2, useCount: 1 }), NOW), "active");
  assert.equal(joinCodeStatus(row()), "active");
});

test("toJoinCodeView formats the code and serializes expiry", async () => {
  const { toJoinCodeView } = await load();
  assert.deepEqual(toJoinCodeView(row({ maxUses: 30, useCount: 4 }), NOW), {
    displayCode: "ABCD-2345",
    status: "active",
    expiresAt: null,
    maxUses: 30,
    useCount: 4,
  });
  const view = toJoinCodeView(row({ expiresAt: NOW, disabledAt: NOW }));
  assert.equal(view.status, "disabled");
  assert.equal(view.expiresAt, NOW.toISOString());
});

test("getClassroomJoinCodeView looks the code up by classroom", async () => {
  const { getClassroomJoinCodeView } = await load();
  assert.equal(await getClassroomJoinCodeView("class-1"), null);
  existingRow = row({ useCount: 2 });
  assert.equal((await getClassroomJoinCodeView("class-1", NOW))?.useCount, 2);
  assert.deepEqual(findUniqueCalls.at(-1), { where: { classroomId: "class-1" } });
});

// ---- rotate / disable ------------------------------------------------------

test("rotateClassroomJoinCode creates a code with expiry and seat limit and audits in the transaction", async () => {
  const { rotateClassroomJoinCode } = await load();
  const { joinCode, replaced } = await rotateClassroomJoinCode({
    classroomId: "class-1",
    actorId: "teacher-1",
    expiresInDays: 7,
    maxUses: 30,
    now: NOW,
    random: sequence([1]),
    audit: (rotated) => auditInput(`rotated:${rotated.replaced}`),
  });
  assert.equal(replaced, false);
  assert.equal(joinCode.code, "BBBBBBBB");
  const expected = {
    createdById: "teacher-1",
    expiresAt: new Date(NOW.getTime() + 7 * DAY_MS),
    maxUses: 30,
    useCount: 0,
    disabledAt: null,
  };
  assert.deepEqual(upsertCalls, [
    {
      where: { classroomId: "class-1" },
      create: { classroomId: "class-1", code: "BBBBBBBB", ...expected },
      update: { code: "BBBBBBBB", ...expected },
    },
  ]);
  assert.deepEqual(auditCalls, [{ action: "rotated:false", client: transactionClient }]);
});

test("rotateClassroomJoinCode replaces an existing code and resets usage", async () => {
  existingRow = row({ useCount: 9, disabledAt: NOW });
  const { rotateClassroomJoinCode } = await load();
  const { joinCode, replaced } = await rotateClassroomJoinCode({ classroomId: "class-1", actorId: "admin-1" });
  assert.equal(replaced, true);
  assert.equal(joinCode.expiresAt, null);
  assert.equal(joinCode.maxUses, null);
  const update = upsertCalls[0]?.update as Record<string, unknown>;
  assert.equal(update.useCount, 0);
  assert.equal(update.disabledAt, null);
  assert.equal(update.expiresAt, null);
  assert.equal(auditCalls.length, 0);
});

test("rotateClassroomJoinCode retries code collisions with a fresh code", async () => {
  upsertErrors = [uniqueViolation(), uniqueViolation()];
  const { rotateClassroomJoinCode } = await load();
  const { joinCode } = await rotateClassroomJoinCode({
    classroomId: "class-1",
    actorId: "teacher-1",
    random: sequence([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]),
    audit: () => auditInput("rotated"),
  });
  assert.equal(upsertCalls.length, 3);
  assert.equal(joinCode.code, "CCCCCCCC");
  assert.equal(auditCalls.length, 1, "only the committed attempt is audited");
});

test("rotateClassroomJoinCode gives up after repeated collisions and rethrows other errors", async () => {
  const { rotateClassroomJoinCode } = await load();
  upsertErrors = Array.from({ length: 5 }, uniqueViolation);
  await assert.rejects(
    rotateClassroomJoinCode({ classroomId: "class-1", actorId: "teacher-1" }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
  );
  assert.equal(upsertCalls.length, 5);

  upsertCalls = [];
  upsertErrors = [new Error("db down")];
  await assert.rejects(rotateClassroomJoinCode({ classroomId: "class-1", actorId: "teacher-1" }), /db down/);
  assert.equal(upsertCalls.length, 1);
});

test("disableClassroomJoinCode disables an active code and audits in the transaction", async () => {
  disableUpdateCount = 1;
  const { disableClassroomJoinCode } = await load();
  assert.equal(
    await disableClassroomJoinCode("class-1", { now: NOW, audit: () => auditInput("disabled") }),
    "disabled",
  );
  assert.deepEqual(disableCalls, [{ where: { classroomId: "class-1", disabledAt: null }, data: { disabledAt: NOW } }]);
  assert.deepEqual(auditCalls, [{ action: "disabled", client: transactionClient }]);
  assert.equal(await disableClassroomJoinCode("class-1"), "disabled");
});

test("disableClassroomJoinCode reports repeats and missing codes without auditing", async () => {
  const { disableClassroomJoinCode } = await load();
  const audit = () => auditInput("disabled");
  disableRowCount = 1;
  assert.equal(await disableClassroomJoinCode("class-1", { audit }), "already_disabled");
  disableRowCount = 0;
  assert.equal(await disableClassroomJoinCode("class-1", { audit }), "not_found");
  assert.equal(auditCalls.length, 0);
});

// ---- redeem ----------------------------------------------------------------

test("redeemClassroomJoinCode rejects malformed codes without touching the database", async () => {
  const { redeemClassroomJoinCode } = await load();
  assert.deepEqual(await redeemClassroomJoinCode({ code: "nope", userId: "s1" }), {
    ok: false,
    reason: "invalid_format",
  });
  assert.equal(findUniqueCalls.length, 0);
});

test("redeemClassroomJoinCode reports unknown and archived-classroom codes", async () => {
  const { redeemClassroomJoinCode } = await load();
  lookups = [null];
  assert.deepEqual(await redeemClassroomJoinCode({ code: "abcd-2345", userId: "s1" }), {
    ok: false,
    reason: "not_found",
  });
  assert.deepEqual(findUniqueCalls[0]?.where, { code: "ABCD2345" });

  lookups = [{ ...row(), classroom: { ...CLASSROOM, archivedAt: NOW } }];
  classroomMember = { id: "cm-1" };
  assert.deepEqual(await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1" }), {
    ok: false,
    reason: "archived",
    classroomId: "class-1",
    orgId: "org-1",
  });
});

test("existing members succeed without consuming a use or auditing, even on a disabled code", async () => {
  lookups = [{ ...row({ disabledAt: NOW }), classroom: { ...CLASSROOM } }];
  classroomMember = { id: "cm-1" };
  const { redeemClassroomJoinCode } = await load();
  assert.deepEqual(
    await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1", now: NOW, audit: () => auditInput("joined") }),
    {
      ok: true,
      classroomId: "class-1",
      classroomName: "Period 3",
      orgId: "org-1",
      alreadyMember: true,
      orgMembershipCreated: false,
    },
  );
  assert.equal(claimCalls.length, 0);
  assert.equal(classroomMembershipCreates.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("disabled, expired, and exhausted codes fail closed for new learners", async () => {
  const { redeemClassroomJoinCode } = await load();
  const cases: Array<[Partial<Row>, string]> = [
    [{ disabledAt: NOW }, "disabled"],
    [{ expiresAt: NOW }, "expired"],
    [{ maxUses: 3, useCount: 3 }, "exhausted"],
  ];
  for (const [overrides, reason] of cases) {
    lookups = [{ ...row(overrides), classroom: { ...CLASSROOM } }];
    assert.deepEqual(await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1", now: NOW }), {
      ok: false,
      reason,
      classroomId: "class-1",
      orgId: "org-1",
    });
  }
  assert.equal(claimCalls.length, 0);
  assert.equal(classroomMembershipCreates.length, 0);
});

test("redeeming claims a use, enrolls the learner as Student, and audits in the transaction", async () => {
  lookups = [{ ...row({ maxUses: 30, useCount: 4 }), classroom: { ...CLASSROOM } }];
  const { redeemClassroomJoinCode } = await load();
  assert.deepEqual(
    await redeemClassroomJoinCode({
      code: "ABCD2345",
      userId: "s1",
      now: NOW,
      audit: (joined) => auditInput(`joined:${joined.orgMembershipCreated}`),
    }),
    {
      ok: true,
      classroomId: "class-1",
      classroomName: "Period 3",
      orgId: "org-1",
      alreadyMember: false,
      orgMembershipCreated: true,
    },
  );
  assert.deepEqual(claimCalls, [
    {
      where: { id: "jc-1", code: "ABCD2345", disabledAt: null, useCount: { lt: 30 } },
      data: { useCount: { increment: 1 } },
    },
  ]);
  assert.deepEqual(membershipCreates, [{ data: { userId: "s1", orgId: "org-1", role: "Student" } }]);
  assert.deepEqual(classroomMembershipCreates, [{ data: { classroomId: "class-1", userId: "s1", role: "Student" } }]);
  assert.deepEqual(auditCalls, [{ action: "joined:true", client: transactionClient }]);
});

test("redeeming keeps an existing org membership and claims uncapped codes unconditionally", async () => {
  orgMembership = { id: "m-teacher" };
  const { redeemClassroomJoinCode } = await load();
  const result = await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1" });
  assert.equal(result.ok && result.orgMembershipCreated, false);
  assert.equal(membershipCreates.length, 0);
  assert.equal(classroomMembershipCreates.length, 1);
  assert.deepEqual(claimCalls[0]?.where, { id: "jc-1", code: "ABCD2345", disabledAt: null });
});

test("a lost claim retries against fresh state", async () => {
  lookups = [
    { ...row({ maxUses: 2, useCount: 0 }), classroom: { ...CLASSROOM } },
    { ...row({ maxUses: 2, useCount: 1 }), classroom: { ...CLASSROOM } },
  ];
  claimCounts = [0, 1];
  const { redeemClassroomJoinCode } = await load();
  const result = await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1", now: NOW });
  assert.equal(result.ok, true);
  assert.equal(claimCalls.length, 2);
});

test("a lost claim that leaves the code full reports exhausted", async () => {
  lookups = [
    { ...row({ maxUses: 1, useCount: 0 }), classroom: { ...CLASSROOM } },
    { ...row({ maxUses: 1, useCount: 1 }), classroom: { ...CLASSROOM } },
  ];
  claimCounts = [0];
  const { redeemClassroomJoinCode } = await load();
  const result = await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1", now: NOW });
  assert.deepEqual(result, { ok: false, reason: "exhausted", classroomId: "class-1", orgId: "org-1" });
});

test("redemption reports contention (not exhausted) after repeated lost claims", async () => {
  claimCounts = [0, 0, 0, 0, 0];
  const { redeemClassroomJoinCode } = await load();
  assert.deepEqual(await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1" }), {
    ok: false,
    reason: "contention",
  });
  assert.equal(claimCalls.length, 5);
});

test("a concurrent duplicate join retries and reports alreadyMember", async () => {
  classroomMembershipCreateErrors = [uniqueViolation()];
  const { redeemClassroomJoinCode } = await load();
  const result = await redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1" });
  assert.equal(result.ok && result.alreadyMember, true);
  assert.equal(claimCalls.length, 1);
});

test("redemption rethrows unexpected database errors", async () => {
  classroomMembershipCreateErrors = [new Error("db down")];
  const { redeemClassroomJoinCode } = await load();
  await assert.rejects(redeemClassroomJoinCode({ code: "ABCD2345", userId: "s1" }), /db down/);
});
