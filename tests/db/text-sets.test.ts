/**
 * PostgreSQL integration tests for Text Sets (#1308).
 *
 * Exercises the real domain commands against the database: authoring rules,
 * PRIVATE vs ORG visibility with strict cross-organization isolation, editing
 * by owner/org admin, duplication, assignment as linked unit assignments,
 * unit progress rollups, deletion keeping assignments, cascades, article
 * search, and audit rows for every mutation.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "next-auth";

import { ArticleStatus, ArticleVisibility, AssignmentStatus, type MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assignTextSet,
  createTextSet,
  deleteTextSet,
  duplicateTextSet,
  getClassroomTextSetUnits,
  getTextSetForViewer,
  listAssignableClassrooms,
  listTextSetOrganizations,
  listTextSetsForViewer,
  searchTextSetArticleOptions,
  updateTextSet,
  type TextSetInput,
} from "@/lib/classroom/text-sets";
import { textSetAudit } from "@/lib/classroom/text-set-audit";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

type Viewer = { id: string; role: string };

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

function auditFor(viewer: Viewer) {
  return textSetAudit({
    req: new Request("http://test/api/text-sets"),
    session: { user: { id: viewer.id, role: viewer.role }, expires: "2099-01-01" } as unknown as Session,
    requestId: "req-text-set",
  });
}

async function user(label: string, role = "Reader"): Promise<Viewer> {
  const userId = id(label);
  await prisma.user.create({ data: { id: userId, name: label, role: role as "Reader" } });
  return { id: userId, role };
}

async function org(label: string) {
  const orgId = id(label);
  await prisma.organization.create({ data: { id: orgId, name: label, slug: orgId } });
  return orgId;
}

async function member(viewer: Viewer, orgId: string, role: MembershipRole) {
  await prisma.membership.create({ data: { userId: viewer.id, orgId, role } });
}

async function article(label: string, overrides: Record<string, unknown> = {}) {
  const articleId = id(label);
  await prisma.article.create({
    data: {
      id: articleId,
      title: label,
      content: "<p>x</p>",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      ...overrides,
    },
  });
  return articleId;
}

function input(articleIds: string[], overrides: Partial<TextSetInput> = {}): TextSetInput {
  return {
    title: "  Wildfire recovery  ",
    essentialQuestion: "How do ecosystems recover after wildfire?",
    description: "Read in order.",
    educatorNotes: "Pair with lab 3.",
    visibility: "PRIVATE",
    items: articleIds.map((articleId, index) => ({ articleId, guidingNote: index === 0 ? " Focus on causes " : null })),
    ...overrides,
  };
}

async function auditCount(action: string, targetId: string) {
  return prisma.auditLog.count({ where: { action, targetId } });
}

test("teachers author sets; non-teachers and bad articles are refused", { skip: !enabled }, async () => {
  requirePostgres();
  const orgA = await org("ts_author_org");
  const teacher = await user("ts_author_teacher");
  const student = await user("ts_author_student");
  const admin = await user("ts_author_sysadmin", "Admin");
  await member(teacher, orgA, "Teacher");
  await member(student, orgA, "Student");
  const [a1, a2] = [await article("ts_author_a1"), await article("ts_author_a2")];
  const stranger = await user("ts_author_stranger");
  const privateArticle = await article("ts_author_private", {
    visibility: ArticleVisibility.PRIVATE,
    ownerId: stranger.id,
  });

  assert.deepEqual(await listTextSetOrganizations(teacher), [{ id: orgA, name: "ts_author_org" }]);
  assert.deepEqual(await listTextSetOrganizations(student), []);

  const created = await createTextSet(teacher, orgA, input([a1, a2, a1]), auditFor(teacher));
  assert.ok(created.ok);
  const detail = await getTextSetForViewer(created.id, teacher);
  assert.equal(detail?.title, "Wildfire recovery");
  assert.deepEqual(detail?.items.map((item) => [item.articleId, item.guidingNote]), [
    [a1, "Focus on causes"],
    [a2, null],
  ]);
  assert.equal(detail?.canEdit, true);
  assert.equal(await auditCount("text_set.create", created.id), 1);

  assert.deepEqual(await createTextSet(student, orgA, input([a1]), auditFor(student)), {
    ok: false,
    status: 403,
    reason: "forbidden",
  });
  assert.equal((await createTextSet(teacher, orgA, input([privateArticle]), auditFor(teacher))).ok, false);
  assert.deepEqual(await createTextSet(teacher, orgA, input([]), auditFor(teacher)), {
    ok: false,
    status: 400,
    reason: "empty_items",
  });
  assert.ok((await createTextSet(admin, orgA, input([a1]), auditFor(admin))).ok, "system admins can author anywhere");
});

test("ORG sharing stays inside the organization; PRIVATE stays with the owner", { skip: !enabled }, async () => {
  requirePostgres();
  const [orgA, orgB] = [await org("ts_vis_a"), await org("ts_vis_b")];
  const owner = await user("ts_vis_owner");
  const colleague = await user("ts_vis_colleague");
  const orgAdmin = await user("ts_vis_admin");
  const outsider = await user("ts_vis_outsider");
  await member(owner, orgA, "Teacher");
  await member(colleague, orgA, "Teacher");
  await member(orgAdmin, orgA, "OrgAdmin");
  await member(outsider, orgB, "Teacher");
  const a1 = await article("ts_vis_a1");

  const privateSet = await createTextSet(owner, orgA, input([a1]), auditFor(owner));
  const sharedSet = await createTextSet(owner, orgA, input([a1], { visibility: "ORG", title: "Shared" }), auditFor(owner));
  assert.ok(privateSet.ok && sharedSet.ok);

  assert.equal(await getTextSetForViewer(privateSet.id, colleague), null);
  assert.equal((await getTextSetForViewer(sharedSet.id, colleague))?.canEdit, false);
  assert.equal((await getTextSetForViewer(sharedSet.id, orgAdmin))?.canEdit, true);
  assert.equal(await getTextSetForViewer(sharedSet.id, outsider), null, "other organizations never see it");
  assert.equal(await getTextSetForViewer("missing", owner), null);

  const ownerLists = await listTextSetsForViewer(owner);
  assert.deepEqual(ownerLists.mine.map((set) => set.id).sort(), [privateSet.id, sharedSet.id].sort());
  assert.deepEqual(ownerLists.shared, [], "a teacher's own shared sets are listed under mine");
  const colleagueLists = await listTextSetsForViewer(colleague);
  assert.deepEqual(colleagueLists.shared.map((set) => set.id), [sharedSet.id]);
  assert.equal(colleagueLists.shared[0]?.ownerName, "ts_vis_owner");
  assert.deepEqual((await listTextSetsForViewer(outsider)).shared, []);

  // An owner who leaves the organization loses access to the sets they made there.
  await prisma.membership.deleteMany({ where: { userId: owner.id, orgId: orgA } });
  assert.equal(await getTextSetForViewer(privateSet.id, owner), null);
  assert.equal(await getTextSetForViewer(sharedSet.id, owner), null);
  assert.deepEqual(await listTextSetsForViewer(owner), { mine: [], shared: [] });
  assert.deepEqual(await updateTextSet(sharedSet.id, owner, input([a1]), auditFor(owner)), {
    ok: false,
    status: 404,
    reason: "not_found",
  });
  assert.ok(await getTextSetForViewer(sharedSet.id, orgAdmin), "the org keeps its shared set");
});

test("owners edit and reorder; org admins edit shared sets; colleagues cannot", { skip: !enabled }, async () => {
  requirePostgres();
  const orgA = await org("ts_edit_org");
  const owner = await user("ts_edit_owner");
  const colleague = await user("ts_edit_colleague");
  const orgAdmin = await user("ts_edit_admin");
  await member(owner, orgA, "Teacher");
  await member(colleague, orgA, "Teacher");
  await member(orgAdmin, orgA, "OrgAdmin");
  const [a1, a2, a3] = [await article("ts_edit_a1"), await article("ts_edit_a2"), await article("ts_edit_a3")];

  const shared = await createTextSet(owner, orgA, input([a1, a2], { visibility: "ORG" }), auditFor(owner));
  const privateSet = await createTextSet(owner, orgA, input([a1]), auditFor(owner));
  assert.ok(shared.ok && privateSet.ok);

  assert.deepEqual(await updateTextSet(shared.id, owner, input([a3, a1], { visibility: "ORG" }), auditFor(owner)), { ok: true });
  assert.deepEqual((await getTextSetForViewer(shared.id, owner))?.items.map((item) => item.articleId), [a3, a1]);
  assert.equal(await auditCount("text_set.update", shared.id), 1);

  assert.deepEqual(await updateTextSet(shared.id, colleague, input([a1], { visibility: "ORG" }), auditFor(colleague)), {
    ok: false,
    status: 403,
    reason: "forbidden",
  });
  assert.deepEqual(await updateTextSet(shared.id, orgAdmin, input([a2], { visibility: "ORG", title: "Admin edit" }), auditFor(orgAdmin)), { ok: true });
  assert.deepEqual(await updateTextSet(privateSet.id, colleague, input([a1]), auditFor(colleague)), {
    ok: false,
    status: 404,
    reason: "not_found",
  });
  assert.deepEqual(await updateTextSet("missing", owner, input([a1]), auditFor(owner)), {
    ok: false,
    status: 404,
    reason: "not_found",
  });
  assert.deepEqual(await updateTextSet(shared.id, owner, input([]), auditFor(owner)), {
    ok: false,
    status: 400,
    reason: "empty_items",
  });
});

test("duplicating makes a private copy for the viewer", { skip: !enabled }, async () => {
  requirePostgres();
  const [orgA, orgB] = [await org("ts_dup_a"), await org("ts_dup_b")];
  const owner = await user("ts_dup_owner");
  const colleague = await user("ts_dup_colleague");
  const outsider = await user("ts_dup_outsider");
  await member(owner, orgA, "Teacher");
  await member(colleague, orgA, "Teacher");
  await member(outsider, orgB, "Teacher");
  const [a1, a2] = [await article("ts_dup_a1"), await article("ts_dup_a2")];
  const shared = await createTextSet(owner, orgA, input([a1, a2], { visibility: "ORG", title: "Unit" }), auditFor(owner));
  assert.ok(shared.ok);

  const copy = await duplicateTextSet(shared.id, colleague, auditFor(colleague));
  assert.ok(copy.ok);
  const copied = await getTextSetForViewer(copy.id, colleague);
  assert.equal(copied?.title, "Copy of Unit");
  assert.equal(copied?.visibility, "PRIVATE");
  assert.equal(copied?.ownerId, colleague.id);
  assert.deepEqual(copied?.items.map((item) => item.articleId), [a1, a2]);
  assert.equal(await auditCount("text_set.duplicate", copy.id), 1);

  assert.deepEqual(await duplicateTextSet(shared.id, outsider, auditFor(outsider)), {
    ok: false,
    status: 404,
    reason: "not_found",
  });

  // An owner who is no longer a teacher can still see their set but not author copies.
  await prisma.membership.update({ where: { userId_orgId: { userId: owner.id, orgId: orgA } }, data: { role: "Member" } });
  assert.deepEqual(await duplicateTextSet(shared.id, owner, auditFor(owner)), {
    ok: false,
    status: 403,
    reason: "forbidden",
  });
});

test("assigning creates linked unit assignments and rolls up progress", { skip: !enabled }, async () => {
  requirePostgres();
  const [orgA, orgB] = [await org("ts_assign_a"), await org("ts_assign_b")];
  const teacher = await user("ts_assign_teacher");
  const colleague = await user("ts_assign_colleague");
  const orgAdmin = await user("ts_assign_admin");
  const [s1, s2] = [await user("ts_assign_s1"), await user("ts_assign_s2")];
  await member(teacher, orgA, "Teacher");
  await member(colleague, orgA, "Teacher");
  await member(orgAdmin, orgA, "OrgAdmin");
  const classroomId = id("ts_assign_class");
  const colleagueClass = id("ts_assign_colleague_class");
  const archivedClass = id("ts_assign_archived");
  const otherOrgClass = id("ts_assign_other");
  await prisma.classroom.createMany({
    data: [
      { id: classroomId, orgId: orgA, name: "Period 1", teacherId: teacher.id },
      { id: colleagueClass, orgId: orgA, name: "Period 2", teacherId: colleague.id },
      { id: archivedClass, orgId: orgA, name: "Old", teacherId: teacher.id, archivedAt: new Date() },
      { id: otherOrgClass, orgId: orgB, name: "Elsewhere", teacherId: teacher.id },
    ],
  });
  await prisma.classroomMembership.createMany({
    data: [s1, s2].map((s) => ({ classroomId, userId: s.id, role: "Student" as const })),
  });
  const [a1, a2] = [await article("ts_assign_a1"), await article("ts_assign_a2")];
  const set = await createTextSet(teacher, orgA, input([a1, a2]), auditFor(teacher));
  assert.ok(set.ok);

  assert.deepEqual(await listAssignableClassrooms(teacher, orgA), [{ id: classroomId, name: "Period 1" }]);
  assert.deepEqual(
    (await listAssignableClassrooms(orgAdmin, orgA)).map((classroom) => classroom.name),
    ["Period 1", "Period 2"],
  );

  for (const bad of [[], [colleagueClass], [archivedClass], [otherOrgClass], [classroomId, "missing"]]) {
    assert.deepEqual(await assignTextSet(set.id, teacher, { classroomIds: bad }, auditFor(teacher)), {
      ok: false,
      status: 400,
      reason: "invalid_classrooms",
    });
  }
  assert.deepEqual(await assignTextSet("missing", teacher, { classroomIds: [classroomId] }, auditFor(teacher)), {
    ok: false,
    status: 404,
    reason: "not_found",
  });

  const assigned = await assignTextSet(set.id, teacher, { classroomIds: [classroomId], dueDate: "2026-12-31" }, auditFor(teacher));
  assert.deepEqual(assigned, { ok: true, classrooms: [{ classroomId, created: 2, failed: 0 }] });
  const rows = await prisma.assignment.findMany({
    where: { classroomId, textSetId: set.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, articleId: true, instructions: true, dueDate: true },
  });
  assert.deepEqual(rows.map((row) => row.articleId), [a1, a2]);
  assert.equal(rows[0]?.instructions, "Read in order.\n\nFocus on causes");
  assert.equal(rows[1]?.instructions, "Read in order.");
  assert.ok(rows[0]?.dueDate);
  assert.equal(await auditCount("text_set.assign", set.id), 1);

  await prisma.assignmentCompletion.createMany({
    data: [
      { assignmentId: rows[0]!.id, studentId: s1.id, status: AssignmentStatus.COMPLETED },
      { assignmentId: rows[1]!.id, studentId: s1.id, status: AssignmentStatus.COMPLETED },
      { assignmentId: rows[0]!.id, studentId: s2.id, status: AssignmentStatus.COMPLETED },
      { assignmentId: rows[1]!.id, studentId: s2.id, status: AssignmentStatus.IN_PROGRESS },
    ],
  });
  assert.deepEqual(await getClassroomTextSetUnits(classroomId), [
    {
      textSetId: set.id,
      title: "Wildfire recovery",
      essentialQuestion: "How do ecosystems recover after wildfire?",
      articleCount: 2,
      studentsFinished: 1,
      studentCount: 2,
      completionPercent: 75,
    },
  ]);
  assert.deepEqual(await getClassroomTextSetUnits(colleagueClass), []);

  // An article that becomes private is skipped on a later assignment.
  await prisma.article.update({ where: { id: a2 }, data: { visibility: ArticleVisibility.PRIVATE, ownerId: colleague.id } });
  const partial = await assignTextSet(set.id, teacher, { classroomIds: [classroomId] }, auditFor(teacher));
  assert.deepEqual(partial, { ok: true, classrooms: [{ classroomId, created: 1, failed: 1 }] });
});

test("deleting keeps assignments; cascades and owner removal behave", { skip: !enabled }, async () => {
  requirePostgres();
  const orgA = await org("ts_del_org");
  const owner = await user("ts_del_owner");
  const colleague = await user("ts_del_colleague");
  await member(owner, orgA, "Teacher");
  await member(colleague, orgA, "Teacher");
  const classroomId = id("ts_del_class");
  await prisma.classroom.create({ data: { id: classroomId, orgId: orgA, name: "C", teacherId: owner.id } });
  const a1 = await article("ts_del_a1");
  const set = await createTextSet(owner, orgA, input([a1], { visibility: "ORG" }), auditFor(owner));
  const other = await createTextSet(owner, orgA, input([a1]), auditFor(owner));
  assert.ok(set.ok && other.ok);
  await assignTextSet(set.id, owner, { classroomIds: [classroomId] }, auditFor(owner));

  assert.deepEqual(await deleteTextSet(set.id, colleague, auditFor(colleague)), { ok: false, status: 403, reason: "forbidden" });
  assert.deepEqual(await deleteTextSet(other.id, colleague, auditFor(colleague)), { ok: false, status: 404, reason: "not_found" });
  assert.deepEqual(await deleteTextSet("missing", owner, auditFor(owner)), { ok: false, status: 404, reason: "not_found" });
  assert.deepEqual(await deleteTextSet(set.id, owner, auditFor(owner)), { ok: true });
  assert.equal(await prisma.textSetItem.count({ where: { textSetId: set.id } }), 0);
  const kept = await prisma.assignment.findFirstOrThrow({ where: { classroomId } });
  assert.equal(kept.textSetId, null, "assignments survive with the unit link cleared");
  assert.equal(await auditCount("text_set.delete", set.id), 1);

  await prisma.user.delete({ where: { id: owner.id } });
  assert.equal((await prisma.textSet.findUniqueOrThrow({ where: { id: other.id } })).ownerId, null);
  await prisma.organization.delete({ where: { id: orgA } });
  assert.equal(await prisma.textSet.count({ where: { id: other.id } }), 0);
});

test("article search is limited to teachers and the org's readable articles", { skip: !enabled }, async () => {
  requirePostgres();
  const orgA = await org("ts_search_org");
  const teacher = await user("ts_search_teacher");
  const student = await user("ts_search_student");
  await member(teacher, orgA, "Teacher");
  await member(student, orgA, "Student");
  const visible = await article("ts_search_coral_reefs");
  await article("ts_search_draft_coral", { status: ArticleStatus.DRAFT });

  const results = (await searchTextSetArticleOptions(teacher, orgA, "ts_search_coral"))!.map((row) => row.id);
  assert.deepEqual(results, [visible]);
  assert.ok(((await searchTextSetArticleOptions(teacher, orgA, "")) ?? []).length > 0);
  assert.equal(await searchTextSetArticleOptions(student, orgA, "coral"), null);
});
