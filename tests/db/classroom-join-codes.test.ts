/**
 * PostgreSQL integration tests for classroom join codes (#1309).
 *
 * Covers: concurrent redemption honouring `maxUses` exactly (conditional claim),
 * a whole class joining an uncapped code at once,
 * concurrent duplicate joins by one learner consuming a single use, Student
 * org membership creation without downgrading existing roles, rotation
 * invalidating the previous code, expiry/disable/archive failing closed,
 * audit rows committing (and rolling back) with their mutation, and
 * Classroom→ClassroomJoinCode cascade.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 * Skips cleanly under plain `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

import {
  disableClassroomJoinCode,
  redeemClassroomJoinCode,
  rotateClassroomJoinCode,
} from "@/lib/classroom/join-codes";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

const DAY_MS = 24 * 60 * 60 * 1000;

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

async function createReaders(count: number, label: string): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, index) => id(`${label}${index}`));
  await prisma.user.createMany({ data: ids.map((userId) => ({ id: userId, name: userId, role: "Reader" })) });
  return ids;
}

async function createClassroom(label: string): Promise<{ classroomId: string; orgId: string; teacherId: string }> {
  const orgId = id(`${label}_org`);
  const classroomId = id(`${label}_class`);
  const [teacherId] = await createReaders(1, `${label}_teacher`);
  await prisma.organization.create({ data: { id: orgId, name: label, slug: orgId } });
  await prisma.membership.create({ data: { userId: teacherId!, orgId, role: "Teacher" } });
  await prisma.classroom.create({ data: { id: classroomId, orgId, name: `${label} class`, teacherId: teacherId! } });
  return { classroomId, orgId, teacherId: teacherId! };
}

test("concurrent redemptions never exceed maxUses", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, teacherId } = await createClassroom("jc_cap");
  const { joinCode } = await rotateClassroomJoinCode({ classroomId, actorId: teacherId, maxUses: 3 });
  const learners = await createReaders(8, "jc_cap_learner");

  const results = await Promise.all(
    learners.map((userId) => redeemClassroomJoinCode({ code: joinCode.code, userId })),
  );

  const joined = results.filter((result) => result.ok);
  assert.equal(joined.length, 3);
  assert.ok(results.filter((result) => !result.ok).every((result) => !result.ok && result.reason === "exhausted"));
  assert.equal(await prisma.classroomMembership.count({ where: { classroomId, role: "Student" } }), 3);
  const stored = await prisma.classroomJoinCode.findUniqueOrThrow({ where: { classroomId } });
  assert.equal(stored.useCount, 3);
});

test("a whole class joining at once on an uncapped code all succeed", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, teacherId } = await createClassroom("jc_rush");
  const { joinCode } = await rotateClassroomJoinCode({ classroomId, actorId: teacherId });
  const learners = await createReaders(30, "jc_rush_learner");

  const results = await Promise.all(
    learners.map((userId) => redeemClassroomJoinCode({ code: joinCode.code, userId })),
  );

  assert.ok(results.every((result) => result.ok && !result.alreadyMember));
  const stored = await prisma.classroomJoinCode.findUniqueOrThrow({ where: { classroomId } });
  assert.equal(stored.useCount, 30);
});

test("concurrent duplicate joins by one learner consume a single use", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, orgId, teacherId } = await createClassroom("jc_dup");
  const { joinCode } = await rotateClassroomJoinCode({ classroomId, actorId: teacherId, maxUses: 5 });
  const [learner] = await createReaders(1, "jc_dup_learner");

  const results = await Promise.all(
    Array.from({ length: 4 }, () => redeemClassroomJoinCode({ code: joinCode.code, userId: learner! })),
  );

  assert.ok(results.every((result) => result.ok));
  assert.equal(results.filter((result) => result.ok && !result.alreadyMember).length, 1);
  assert.equal(await prisma.classroomMembership.count({ where: { classroomId, userId: learner! } }), 1);
  assert.equal(await prisma.membership.count({ where: { orgId, userId: learner! } }), 1);
  const stored = await prisma.classroomJoinCode.findUniqueOrThrow({ where: { classroomId } });
  assert.equal(stored.useCount, 1);
});

test("joining creates a Student org membership but never downgrades an existing role", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, orgId, teacherId } = await createClassroom("jc_role");
  const { joinCode } = await rotateClassroomJoinCode({ classroomId, actorId: teacherId });
  const [newcomer, colleague] = await createReaders(2, "jc_role_user");
  await prisma.membership.create({ data: { userId: colleague!, orgId, role: "Teacher" } });

  const first = await redeemClassroomJoinCode({ code: joinCode.code.toLowerCase(), userId: newcomer! });
  const second = await redeemClassroomJoinCode({ code: `${joinCode.code.slice(0, 4)}-${joinCode.code.slice(4)}`, userId: colleague! });

  assert.equal(first.ok && first.orgMembershipCreated, true);
  assert.equal(second.ok && second.orgMembershipCreated, false);
  const roles = await prisma.membership.findMany({
    where: { orgId, userId: { in: [newcomer!, colleague!] } },
    select: { userId: true, role: true },
  });
  assert.deepEqual(
    Object.fromEntries(roles.map((membership) => [membership.userId, membership.role])),
    { [newcomer!]: "Student", [colleague!]: "Teacher" },
  );
  assert.equal(await prisma.classroomMembership.count({ where: { classroomId, role: "Student" } }), 2);
});

test("rotation, expiry, disable, and archive fail closed", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, teacherId } = await createClassroom("jc_closed");
  const [learner] = await createReaders(1, "jc_closed_learner");

  const first = await rotateClassroomJoinCode({ classroomId, actorId: teacherId, expiresInDays: 1 });
  const rotated = await rotateClassroomJoinCode({ classroomId, actorId: teacherId, expiresInDays: 1 });
  assert.equal(rotated.replaced, true);
  assert.notEqual(rotated.joinCode.code, first.joinCode.code);
  assert.equal(await prisma.classroomJoinCode.count({ where: { classroomId } }), 1);

  const old = await redeemClassroomJoinCode({ code: first.joinCode.code, userId: learner! });
  assert.deepEqual(old, { ok: false, reason: "not_found" });

  const later = new Date(Date.now() + 2 * DAY_MS);
  const expired = await redeemClassroomJoinCode({ code: rotated.joinCode.code, userId: learner!, now: later });
  assert.equal(!expired.ok && expired.reason, "expired");

  assert.equal(await disableClassroomJoinCode(classroomId), "disabled");
  assert.equal(await disableClassroomJoinCode(classroomId), "already_disabled");
  const disabled = await redeemClassroomJoinCode({ code: rotated.joinCode.code, userId: learner! });
  assert.equal(!disabled.ok && disabled.reason, "disabled");

  const reissued = await rotateClassroomJoinCode({ classroomId, actorId: teacherId });
  await prisma.classroom.update({ where: { id: classroomId }, data: { archivedAt: new Date() } });
  const archived = await redeemClassroomJoinCode({ code: reissued.joinCode.code, userId: learner! });
  assert.equal(!archived.ok && archived.reason, "archived");
  assert.equal(await prisma.classroomMembership.count({ where: { classroomId, userId: learner! } }), 0);
});

test("deleting a classroom cascades to its join code; deleting the issuer keeps it", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, orgId } = await createClassroom("jc_cascade");
  const [admin] = await createReaders(1, "jc_cascade_admin");
  await prisma.membership.create({ data: { userId: admin!, orgId, role: "OrgAdmin" } });
  await rotateClassroomJoinCode({ classroomId, actorId: admin! });

  await prisma.user.delete({ where: { id: admin! } });
  const kept = await prisma.classroomJoinCode.findUniqueOrThrow({ where: { classroomId } });
  assert.equal(kept.createdById, null);

  await prisma.classroom.delete({ where: { id: classroomId } });
  assert.equal(await prisma.classroomJoinCode.count({ where: { classroomId } }), 0);
});

test("audit rows commit with their mutation and roll back with it", { skip: !enabled }, async () => {
  requirePostgres();
  const { classroomId, teacherId } = await createClassroom("jc_audit");
  const [learner, unlucky] = await createReaders(2, "jc_audit_learner");
  const auditFor = (actorId: string, action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]) => ({
    req: new Request("http://test/api/classrooms/join"),
    session: { user: { id: actorId, role: "Reader" } },
    action,
    targetType: "classroom",
    targetId: classroomId,
    metadata: { probe: true },
  });

  const { joinCode } = await rotateClassroomJoinCode({
    classroomId,
    actorId: teacherId,
    audit: () => auditFor(teacherId, AUDIT_ACTIONS.classroomJoinCodeRotated),
  });
  await redeemClassroomJoinCode({
    code: joinCode.code,
    userId: learner!,
    audit: () => auditFor(learner!, AUDIT_ACTIONS.classroomJoinedViaCode),
  });
  assert.equal(
    await prisma.auditLog.count({
      where: { targetId: classroomId, action: { in: ["classroom.join_code.rotated", "classroom.joined_via_code"] } },
    }),
    2,
  );

  // An audit write that fails inside the transaction undoes the enrollment and the claimed seat.
  await assert.rejects(
    redeemClassroomJoinCode({
      code: joinCode.code,
      userId: unlucky!,
      audit: () => {
        throw new Error("audit unavailable");
      },
    }),
    /audit unavailable/,
  );
  assert.equal(await prisma.classroomMembership.count({ where: { classroomId, userId: unlucky! } }), 0);
  const stored = await prisma.classroomJoinCode.findUniqueOrThrow({ where: { classroomId } });
  assert.equal(stored.useCount, 1);
});
