/**
 * PostgreSQL integration tests for multi-tenant models:
 * Organization, Membership, Classroom, Assignment, AssignmentCompletion.
 *
 * Covers: Membership unique-constraint rejection, Organization→Membership cascade
 * delete, AssignmentCompletion upsert idempotency, and
 * Classroom→Assignment/AssignmentCompletion cascade.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 * Skips cleanly under plain `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { AssignmentStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

test("Membership unique constraint rejects duplicate (userId, orgId) pair", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const userId = id("mc_user");
  const orgId = id("mc_org");

  await prisma.user.create({ data: { id: userId, name: "MC User", role: "Reader" } });
  await prisma.organization.create({ data: { id: orgId, name: "MC Org", slug: orgId } });
  await prisma.membership.create({ data: { userId, orgId } });

  await assert.rejects(
    prisma.membership.create({ data: { userId, orgId } }),
    /Unique constraint failed|Unique constraint|duplicate key value/,
  );
});

test("Organization delete cascades to Membership rows", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const userId = id("orgcasc_user");
  const orgId = id("orgcasc_org");

  await prisma.user.create({ data: { id: userId, name: "Org Cascade User", role: "Reader" } });
  await prisma.organization.create({ data: { id: orgId, name: "Cascade Org", slug: orgId } });
  await prisma.membership.create({ data: { userId, orgId } });

  assert.equal(await prisma.membership.count({ where: { orgId } }), 1);

  await prisma.organization.delete({ where: { id: orgId } });

  assert.equal(await prisma.membership.count({ where: { orgId } }), 0);
});

test("AssignmentCompletion upsert is idempotent — second call updates, does not duplicate", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const teacherId = id("upsert_teacher");
  const studentId = id("upsert_student");
  const orgId = id("upsert_org");
  const articleId = id("upsert_article");
  const classroomId = id("upsert_classroom");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "Upsert Teacher", role: "Reader" },
      { id: studentId, name: "Upsert Student", role: "Reader" },
    ],
  });
  await prisma.organization.create({ data: { id: orgId, name: "Upsert Org", slug: orgId } });
  await prisma.article.create({
    data: { id: articleId, title: "Upsert Article", content: "Body for upsert test" },
  });
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "Upsert Classroom", teacherId },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId },
  });

  // First upsert — creates the row
  await prisma.assignmentCompletion.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
    create: { assignmentId: assignment.id, studentId, status: AssignmentStatus.ASSIGNED },
    update: { status: AssignmentStatus.IN_PROGRESS },
  });

  // Second upsert — updates the existing row
  const updated = await prisma.assignmentCompletion.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
    create: { assignmentId: assignment.id, studentId, status: AssignmentStatus.ASSIGNED },
    update: { status: AssignmentStatus.COMPLETED },
  });

  assert.equal(updated.status, AssignmentStatus.COMPLETED);
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { assignmentId: assignment.id } }),
    1,
    "upsert must not create a second row",
  );
});

test("Classroom delete cascades to Assignment and AssignmentCompletion", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const teacherId = id("clcasc_teacher");
  const studentId = id("clcasc_student");
  const orgId = id("clcasc_org");
  const articleId = id("clcasc_article");
  const classroomId = id("clcasc_classroom");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "CL Cascade Teacher", role: "Reader" },
      { id: studentId, name: "CL Cascade Student", role: "Reader" },
    ],
  });
  await prisma.organization.create({ data: { id: orgId, name: "CL Cascade Org", slug: orgId } });
  await prisma.article.create({
    data: { id: articleId, title: "CL Cascade Article", content: "Body for cascade test" },
  });
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "CL Cascade Classroom", teacherId },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId },
  });
  await prisma.assignmentCompletion.create({
    data: { assignmentId: assignment.id, studentId, status: AssignmentStatus.ASSIGNED },
  });

  assert.equal(await prisma.assignment.count({ where: { classroomId } }), 1);
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { assignmentId: assignment.id } }),
    1,
  );

  await prisma.classroom.delete({ where: { id: classroomId } });

  assert.equal(
    await prisma.assignment.count({ where: { classroomId } }),
    0,
    "assignments should be deleted on classroom cascade",
  );
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { assignmentId: assignment.id } }),
    0,
    "completions should be deleted on assignment cascade",
  );
});
