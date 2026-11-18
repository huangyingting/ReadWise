/**
 * Text Sets (#1308): teacher-curated, ordered, framed groups of articles for
 * an instructional unit, owned within one Organization and optionally shared
 * with the org's teachers (`visibility: "ORG"`).
 *
 * Authorization (system admins pass every check):
 *   - author: a membership with `classroom.manage` (Teacher/OrgAdmin) in the org;
 *   - view: the owner, or — for ORG sets — any teacher/admin of that org;
 *   - edit/delete: the owner, or — for ORG sets — an org admin (`org.manage`);
 *   - duplicate: anyone who can view (the copy is private to them);
 *   - assign: anyone who can view, into active classrooms they manage in the
 *     set's org.
 * Cross-organization access is always refused. Items must be readable in the
 * org's article context. Mutations write their audit row in the same
 * transaction; metadata carries ids/counts only, never set text.
 */
import type { MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES } from "@/lib/rbac";
import { hasOrgCapability, isSystemAdmin } from "@/lib/org/guards";
import { articleAccessContext, readableArticleWhere } from "@/lib/article-library";
import {
  AUDIT_ACTIONS,
  recordAuditFromRequest,
  type AuditAction,
  type AuditRequestInput,
} from "@/lib/security/audit";
import { canManageClassroom } from "./guards";
import { createArticleAssignment } from "./article-assignments";

export const TEXT_SET_VISIBILITIES = ["PRIVATE", "ORG"] as const;
export type TextSetVisibility = (typeof TEXT_SET_VISIBILITIES)[number];
export const TEXT_SET_MAX_ITEMS = 20;

type Viewer = { id: string; role?: string | null };
type MembershipRow = { orgId: string; role: MembershipRole };

export type TextSetItemInput = { articleId: string; guidingNote?: string | null };

export type TextSetInput = {
  title: string;
  essentialQuestion?: string | null;
  description?: string | null;
  educatorNotes?: string | null;
  visibility: TextSetVisibility;
  items: TextSetItemInput[];
};

export type TextSetSummary = {
  id: string;
  organizationId: string;
  organizationName: string;
  title: string;
  essentialQuestion: string | null;
  visibility: TextSetVisibility;
  itemCount: number;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: Date;
};

export type TextSetDetail = TextSetSummary & {
  description: string | null;
  educatorNotes: string | null;
  items: Array<{
    articleId: string;
    title: string;
    source: string | null;
    difficulty: string | null;
    guidingNote: string | null;
  }>;
  canEdit: boolean;
};

export type TextSetFailure =
  | { ok: false; status: 400; reason: "invalid_articles" | "invalid_classrooms" | "empty_items" }
  | { ok: false; status: 403; reason: "forbidden" }
  | { ok: false; status: 404; reason: "not_found" };

/** What a mutation audits; the route turns it into a request-scoped audit row. */
export type TextSetAuditEntry = {
  action: AuditAction;
  targetId: string;
  metadata: Record<string, unknown>;
};
type AuditFactory = (entry: TextSetAuditEntry) => AuditRequestInput;

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asVisibility(value: string): TextSetVisibility {
  return value === "ORG" ? "ORG" : "PRIVATE";
}

async function membershipsFor(userId: string): Promise<MembershipRow[]> {
  return prisma.membership.findMany({ where: { userId }, select: { orgId: true, role: true } });
}

function membershipIn(memberships: MembershipRow[], orgId: string) {
  return memberships.find((membership) => membership.orgId === orgId) ?? null;
}

function canAuthorIn(viewer: Viewer, memberships: MembershipRow[], orgId: string): boolean {
  return isSystemAdmin(viewer.role) || hasOrgCapability(membershipIn(memberships, orgId), CAPABILITIES.classroomManage);
}

type AccessSet = { organizationId: string; ownerId: string | null; visibility: string };

/**
 * Owners see their sets while they remain in the set's organization, and edit
 * them while they can still author there; leaving the org ends both.
 */
function isOwnerInOrg(viewer: Viewer, memberships: MembershipRow[], set: AccessSet): boolean {
  return set.ownerId === viewer.id && membershipIn(memberships, set.organizationId) !== null;
}

function canView(viewer: Viewer, memberships: MembershipRow[], set: AccessSet): boolean {
  if (isSystemAdmin(viewer.role) || isOwnerInOrg(viewer, memberships, set)) return true;
  return set.visibility === "ORG" && canAuthorIn(viewer, memberships, set.organizationId);
}

function canEdit(viewer: Viewer, memberships: MembershipRow[], set: AccessSet): boolean {
  if (isSystemAdmin(viewer.role)) return true;
  if (set.ownerId === viewer.id && canAuthorIn(viewer, memberships, set.organizationId)) return true;
  return (
    set.visibility === "ORG" &&
    hasOrgCapability(membershipIn(memberships, set.organizationId), CAPABILITIES.orgManage)
  );
}

/** Organizations where the viewer may author text sets (Teacher/OrgAdmin). */
export async function listTextSetOrganizations(viewer: Viewer): Promise<Array<{ id: string; name: string }>> {
  const memberships = await membershipsFor(viewer.id);
  const orgIds = memberships
    .filter((membership) => canAuthorIn({ id: viewer.id }, memberships, membership.orgId))
    .map((membership) => membership.orgId);
  if (orgIds.length === 0) return [];
  return prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

const SUMMARY_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  essentialQuestion: true,
  visibility: true,
  ownerId: true,
  updatedAt: true,
  organization: { select: { name: true } },
  owner: { select: { name: true } },
  _count: { select: { items: true } },
} as const satisfies Prisma.TextSetSelect;

type SummaryRow = Prisma.TextSetGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary(row: SummaryRow): TextSetSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    title: row.title,
    essentialQuestion: row.essentialQuestion,
    visibility: asVisibility(row.visibility),
    itemCount: row._count.items,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * The viewer's own sets and sets shared in orgs where they teach. Sets owned
 * in an org the viewer has left aren't listed.
 */
export async function listTextSetsForViewer(
  viewer: Viewer,
): Promise<{ mine: TextSetSummary[]; shared: TextSetSummary[] }> {
  const teachingOrgIds = (await listTextSetOrganizations(viewer)).map((org) => org.id);
  const [mine, shared] = await Promise.all([
    prisma.textSet.findMany({
      where: { ownerId: viewer.id, organization: { memberships: { some: { userId: viewer.id } } } },
      select: SUMMARY_SELECT,
      orderBy: { updatedAt: "desc" },
    }),
    teachingOrgIds.length > 0
      ? prisma.textSet.findMany({
          where: {
            organizationId: { in: teachingOrgIds },
            visibility: "ORG",
            NOT: { ownerId: viewer.id },
          },
          select: SUMMARY_SELECT,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  return { mine: mine.map(toSummary), shared: shared.map(toSummary) };
}

/** Full set for a viewer allowed to see it; null when missing or not visible. */
export async function getTextSetForViewer(id: string, viewer: Viewer): Promise<TextSetDetail | null> {
  const row = await prisma.textSet.findUnique({
    where: { id },
    select: {
      ...SUMMARY_SELECT,
      description: true,
      educatorNotes: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          articleId: true,
          guidingNote: true,
          article: { select: { title: true, source: true, difficulty: true } },
        },
      },
    },
  });
  if (!row) return null;
  const memberships = await membershipsFor(viewer.id);
  if (!canView(viewer, memberships, row)) return null;
  return {
    ...toSummary(row),
    description: row.description,
    educatorNotes: row.educatorNotes,
    items: row.items.map((item) => ({
      articleId: item.articleId,
      title: item.article.title,
      source: item.article.source,
      difficulty: item.article.difficulty,
      guidingNote: item.guidingNote,
    })),
    canEdit: canEdit(viewer, memberships, row),
  };
}

/** Distinct article ids, in order, that are readable in the org's context. */
async function validateItems(
  viewer: Viewer,
  organizationId: string,
  items: TextSetItemInput[],
): Promise<TextSetItemInput[] | TextSetFailure> {
  const seen = new Set<string>();
  const unique = items.filter((item) => !seen.has(item.articleId) && seen.add(item.articleId));
  if (unique.length === 0) return { ok: false, status: 400, reason: "empty_items" };
  const readable = await prisma.article.findMany({
    where: readableArticleWhere(articleAccessContext(viewer, organizationId), {
      id: { in: unique.map((item) => item.articleId) },
    }),
    select: { id: true },
  });
  if (readable.length !== unique.length) return { ok: false, status: 400, reason: "invalid_articles" };
  return unique.slice(0, TEXT_SET_MAX_ITEMS);
}

function setFields(input: TextSetInput) {
  return {
    title: input.title.trim(),
    essentialQuestion: trimOrNull(input.essentialQuestion),
    description: trimOrNull(input.description),
    educatorNotes: trimOrNull(input.educatorNotes),
    visibility: input.visibility,
  };
}

function itemRows(items: TextSetItemInput[]) {
  return items.map((item, position) => ({
    articleId: item.articleId,
    position,
    guidingNote: trimOrNull(item.guidingNote),
  }));
}

export async function createTextSet(
  viewer: Viewer,
  organizationId: string,
  input: TextSetInput,
  audit: AuditFactory,
): Promise<{ ok: true; id: string } | TextSetFailure> {
  const memberships = await membershipsFor(viewer.id);
  if (!canAuthorIn(viewer, memberships, organizationId)) return { ok: false, status: 403, reason: "forbidden" };
  const items = await validateItems(viewer, organizationId, input.items);
  if (!Array.isArray(items)) return items;

  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.textSet.create({
      data: { organizationId, ownerId: viewer.id, ...setFields(input), items: { create: itemRows(items) } },
      select: { id: true },
    });
    await recordAuditFromRequest(
      audit({
        action: AUDIT_ACTIONS.textSetCreated,
        targetId: created.id,
        metadata: { orgId: organizationId, visibility: input.visibility, itemCount: items.length },
      }),
      tx,
    );
    return created.id;
  });
  return { ok: true, id };
}

async function loadForMutation(id: string, viewer: Viewer) {
  const row = await prisma.textSet.findUnique({
    where: { id },
    select: { id: true, organizationId: true, ownerId: true, visibility: true },
  });
  if (!row) return { ok: false as const, status: 404 as const, reason: "not_found" as const };
  const memberships = await membershipsFor(viewer.id);
  return { ok: true as const, row, memberships };
}

export async function updateTextSet(
  id: string,
  viewer: Viewer,
  input: TextSetInput,
  audit: AuditFactory,
): Promise<{ ok: true } | TextSetFailure> {
  const loaded = await loadForMutation(id, viewer);
  if (!loaded.ok) return loaded;
  const { row, memberships } = loaded;
  if (!canView(viewer, memberships, row)) return { ok: false, status: 404, reason: "not_found" };
  if (!canEdit(viewer, memberships, row)) return { ok: false, status: 403, reason: "forbidden" };
  const items = await validateItems(viewer, row.organizationId, input.items);
  if (!Array.isArray(items)) return items;

  await prisma.$transaction(async (tx) => {
    await tx.textSetItem.deleteMany({ where: { textSetId: id } });
    await tx.textSet.update({
      where: { id },
      data: { ...setFields(input), items: { create: itemRows(items) } },
    });
    await recordAuditFromRequest(
      audit({
        action: AUDIT_ACTIONS.textSetUpdated,
        targetId: id,
        metadata: {
          orgId: row.organizationId,
          visibility: input.visibility,
          previousVisibility: row.visibility,
          itemCount: items.length,
        },
      }),
      tx,
    );
  });
  return { ok: true };
}

export async function deleteTextSet(
  id: string,
  viewer: Viewer,
  audit: AuditFactory,
): Promise<{ ok: true } | TextSetFailure> {
  const loaded = await loadForMutation(id, viewer);
  if (!loaded.ok) return loaded;
  const { row, memberships } = loaded;
  if (!canView(viewer, memberships, row)) return { ok: false, status: 404, reason: "not_found" };
  if (!canEdit(viewer, memberships, row)) return { ok: false, status: 403, reason: "forbidden" };
  await prisma.$transaction(async (tx) => {
    await tx.textSet.delete({ where: { id } });
    await recordAuditFromRequest(
      audit({
        action: AUDIT_ACTIONS.textSetDeleted,
        targetId: id,
        metadata: { orgId: row.organizationId, visibility: row.visibility },
      }),
      tx,
    );
  });
  return { ok: true };
}

/** Private copy for the viewer in the same org ("Copy of …"). */
export async function duplicateTextSet(
  id: string,
  viewer: Viewer,
  audit: AuditFactory,
): Promise<{ ok: true; id: string } | TextSetFailure> {
  const source = await getTextSetForViewer(id, viewer);
  if (!source) return { ok: false, status: 404, reason: "not_found" };
  const memberships = await membershipsFor(viewer.id);
  if (!canAuthorIn(viewer, memberships, source.organizationId)) return { ok: false, status: 403, reason: "forbidden" };

  const copyId = await prisma.$transaction(async (tx) => {
    const created = await tx.textSet.create({
      data: {
        organizationId: source.organizationId,
        ownerId: viewer.id,
        title: `Copy of ${source.title}`.slice(0, 200),
        essentialQuestion: source.essentialQuestion,
        description: source.description,
        educatorNotes: source.educatorNotes,
        visibility: "PRIVATE",
        items: {
          create: source.items.map((item, position) => ({
            articleId: item.articleId,
            position,
            guidingNote: item.guidingNote,
          })),
        },
      },
      select: { id: true },
    });
    await recordAuditFromRequest(
      audit({
        action: AUDIT_ACTIONS.textSetDuplicated,
        targetId: created.id,
        metadata: { orgId: source.organizationId, sourceId: id },
      }),
      tx,
    );
    return created.id;
  });
  return { ok: true, id: copyId };
}

export type AssignTextSetResult = {
  ok: true;
  classrooms: Array<{ classroomId: string; created: number; failed: number }>;
};

/**
 * Assigns every article in the set, in order, to each classroom as linked
 * assignments (`textSetId`) carrying the item's guiding note as instructions.
 * Every classroom must be active, in the set's org, and managed by the viewer.
 */
export async function assignTextSet(
  id: string,
  viewer: Viewer,
  input: { classroomIds: string[]; dueDate?: string },
  audit: AuditFactory,
): Promise<AssignTextSetResult | TextSetFailure> {
  const set = await getTextSetForViewer(id, viewer);
  if (!set) return { ok: false, status: 404, reason: "not_found" };
  const classroomIds = [...new Set(input.classroomIds)];
  const classrooms = await prisma.classroom.findMany({
    where: { id: { in: classroomIds }, orgId: set.organizationId, archivedAt: null },
    select: { id: true, orgId: true, teacherId: true },
  });
  const memberships = await membershipsFor(viewer.id);
  const membership = membershipIn(memberships, set.organizationId);
  const manageable = classrooms.filter((classroom) => canManageClassroom(viewer, classroom, membership));
  if (classroomIds.length === 0 || manageable.length !== classroomIds.length) {
    return { ok: false, status: 400, reason: "invalid_classrooms" };
  }

  const context = articleAccessContext(viewer, set.organizationId);
  const results: AssignTextSetResult["classrooms"] = [];
  for (const classroom of manageable) {
    let created = 0;
    let failed = 0;
    for (const item of set.items) {
      const result = await createArticleAssignment({
        classroomId: classroom.id,
        organizationId: set.organizationId,
        articleId: item.articleId,
        accessContext: context,
        dueDate: input.dueDate,
        instructions: [set.description, item.guidingNote].filter(Boolean).join("\n\n") || null,
        textSetId: set.id,
      });
      if (result.ok) created += 1;
      else failed += 1;
    }
    results.push({ classroomId: classroom.id, created, failed });
  }
  await recordAuditFromRequest(
    audit({
      action: AUDIT_ACTIONS.textSetAssigned,
      targetId: id,
      metadata: {
        orgId: set.organizationId,
        classroomCount: results.length,
        assignmentCount: results.reduce((total, row) => total + row.created, 0),
      },
    }),
  );
  return { ok: true, classrooms: results };
}

/** Articles a teacher may add to a set in `organizationId` (title/author/source search). */
export async function searchTextSetArticleOptions(viewer: Viewer, organizationId: string, query: string) {
  const memberships = await membershipsFor(viewer.id);
  if (!canAuthorIn(viewer, memberships, organizationId)) return null;
  const trimmed = query.trim();
  return prisma.article.findMany({
    where: readableArticleWhere(articleAccessContext(viewer, organizationId), {
      ...(trimmed
        ? {
            OR: [
              { title: { contains: trimmed } },
              { author: { contains: trimmed } },
              { source: { contains: trimmed } },
            ],
          }
        : {}),
    }),
    select: { id: true, title: true, source: true, difficulty: true },
    orderBy: [{ publishedAt: "desc" }, { title: "asc" }],
    take: 20,
  });
}

export type ClassroomTextSetUnit = {
  textSetId: string;
  title: string;
  essentialQuestion: string | null;
  articleCount: number;
  /** Students who completed every article in the unit. */
  studentsFinished: number;
  studentCount: number;
  /** Completed (student, article) pairs over all expected pairs, 0–100. */
  completionPercent: number;
};

/**
 * Unit-level progress for each Text Set assigned in a classroom: how many
 * students finished every article and the overall completion rate across the
 * unit's whole-class assignments.
 */
export async function getClassroomTextSetUnits(classroomId: string): Promise<ClassroomTextSetUnit[]> {
  const [assignments, students] = await Promise.all([
    prisma.assignment.findMany({
      where: { classroomId, textSetId: { not: null } },
      select: {
        textSetId: true,
        textSet: { select: { title: true, essentialQuestion: true } },
        completions: { where: { status: "COMPLETED" }, select: { studentId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.classroomMembership.findMany({ where: { classroomId, role: "Student" }, select: { userId: true } }),
  ]);
  const studentIds = students.map((student) => student.userId);
  const units = new Map<string, { title: string; essentialQuestion: string | null; completedSets: Set<string>[] }>();
  for (const assignment of assignments) {
    const unit = units.get(assignment.textSetId!) ?? {
      title: assignment.textSet!.title,
      essentialQuestion: assignment.textSet!.essentialQuestion,
      completedSets: [],
    };
    unit.completedSets.push(new Set(assignment.completions.map((completion) => completion.studentId)));
    units.set(assignment.textSetId!, unit);
  }
  return [...units].map(([textSetId, unit]) => {
    const completedPairs = unit.completedSets.reduce(
      (total, completed) => total + studentIds.filter((id) => completed.has(id)).length,
      0,
    );
    const expectedPairs = unit.completedSets.length * studentIds.length;
    return {
      textSetId,
      title: unit.title,
      essentialQuestion: unit.essentialQuestion,
      articleCount: unit.completedSets.length,
      studentsFinished: studentIds.filter((id) => unit.completedSets.every((completed) => completed.has(id))).length,
      studentCount: studentIds.length,
      completionPercent: expectedPairs === 0 ? 0 : Math.round((completedPairs / expectedPairs) * 100),
    };
  });
}

/** Active classrooms in the org the viewer may assign a text set to. */
export async function listAssignableClassrooms(
  viewer: Viewer,
  organizationId: string,
): Promise<Array<{ id: string; name: string }>> {
  const [classrooms, memberships] = await Promise.all([
    prisma.classroom.findMany({
      where: { orgId: organizationId, archivedAt: null },
      select: { id: true, name: true, orgId: true, teacherId: true },
      orderBy: { name: "asc" },
    }),
    membershipsFor(viewer.id),
  ]);
  const membership = membershipIn(memberships, organizationId);
  return classrooms
    .filter((classroom) => canManageClassroom(viewer, classroom, membership))
    .map(({ id, name }) => ({ id, name }));
}
