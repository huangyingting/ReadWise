/**
 * Classroom annotations (#1307): guided margin prompts and learner replies.
 *
 * Teachers who manage a classroom pin passage-anchored prompts
 * (`AssignmentAnnotation`) to an assignment; the assignment's students see
 * them in the reader and may reply to a prompt or submit an evidence
 * highlight (`AssignmentAnnotationResponse`). Anchors use the same
 * quote/offset/prefix/suffix selector as personal highlights.
 *
 * Privacy: personal `Highlight` rows are never read here — a learner's
 * highlight only reaches a teacher when the learner explicitly submits it as
 * evidence, which copies the anchor (and any explanation) into a response.
 * Responses are visible only to their author and the classroom's managers.
 *
 * Teacher prompt changes are audited with ids only (never prompt text);
 * learner responses are personal content and are never audited or logged.
 */
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAnchor } from "@/lib/annotations";
import {
  recordAuditFromRequest,
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditRequestInput,
} from "@/lib/security/audit";
import { canManageClassroom } from "./guards";
import { assignmentLiveWhere, assignmentVisibleToStudentWhere } from "./targeting";
import { ANNOTATION_QUOTE_MAX_LENGTH } from "./annotation-limits";
import { ORIGINAL_LEVEL, type ReadingLevelKey } from "@/lib/article-levels/levels";
import { getArticleLevelVariant } from "@/lib/article-levels/variants";

type Viewer = { id: string; role?: string | null };

export type AnnotationAnchor = {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix?: string;
  suffix?: string;
  /** Reading level whose text the offsets index (#1303); defaults to "original". */
  levelKey?: ReadingLevelKey;
};

export type GuidedAnnotationView = {
  id: string;
  assignmentId: string;
  classroomName: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  prompt: string;
  levelKey: string;
  /** True when the viewer manages the classroom (may edit or delete). */
  canEdit: boolean;
  updatedAt: Date;
};

export type AnnotationResponseView = {
  id: string;
  assignmentId: string;
  annotationId: string | null;
  quote: string | null;
  startOffset: number | null;
  endOffset: number | null;
  body: string;
  levelKey: string;
  createdAt: Date;
};

export type AssignmentChoice = { assignmentId: string; classroomName: string };

export type ReaderAnnotationContext = {
  /** Assignments of this article in classrooms the viewer manages. */
  teaching: AssignmentChoice[];
  /** The viewer's own live assignments of this article. */
  learning: AssignmentChoice[];
  guides: GuidedAnnotationView[];
  /** The viewer's own replies and evidence. */
  responses: AnnotationResponseView[];
};

export type AnnotationFailure =
  | { ok: false; status: 400; reason: "invalid_anchor" | "empty_response" }
  | { ok: false; status: 403; reason: "forbidden" }
  | { ok: false; status: 404; reason: "not_found" }
  | { ok: false; status: 409; reason: "archived" };

type AuditFactory = (entry: { action: AuditAction; targetId: string; metadata: Record<string, unknown> }) => AuditRequestInput;

const NOT_FOUND = { ok: false, status: 404, reason: "not_found" } as const;
const FORBIDDEN = { ok: false, status: 403, reason: "forbidden" } as const;
const MAX_TEACHING_ASSIGNMENTS = 50;

const GUIDE_SELECT = {
  id: true,
  assignmentId: true,
  quote: true,
  startOffset: true,
  endOffset: true,
  prefix: true,
  suffix: true,
  prompt: true,
  levelKey: true,
  updatedAt: true,
} as const;

const RESPONSE_SELECT = {
  id: true,
  assignmentId: true,
  annotationId: true,
  quote: true,
  startOffset: true,
  endOffset: true,
  body: true,
  levelKey: true,
  createdAt: true,
} as const;

function normalizeAnchor(anchor: AnnotationAnchor) {
  if (anchor.quote.length > ANNOTATION_QUOTE_MAX_LENGTH || !validateAnchor(anchor).ok) return null;
  return {
    quote: anchor.quote,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    prefix: anchor.prefix ?? "",
    suffix: anchor.suffix ?? "",
  };
}

/** True when the article has the reading level (the original always exists). */
async function levelExists(articleId: string, levelKey: ReadingLevelKey): Promise<boolean> {
  return levelKey === ORIGINAL_LEVEL || (await getArticleLevelVariant(articleId, levelKey)) !== null;
}

async function membershipRole(userId: string, orgId: string) {
  return prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { role: true },
  }) as Promise<{ role: MembershipRole } | null>;
}

/** Loads an assignment and whether the viewer manages its classroom. */
export async function assignmentAccess(assignmentId: string, viewer: Viewer) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      articleId: true,
      article: { select: { title: true } },
      classroom: { select: { id: true, name: true, orgId: true, teacherId: true, archivedAt: true } },
    },
  });
  if (!assignment) return null;
  const membership = await membershipRole(viewer.id, assignment.classroom.orgId);
  return { assignment, manages: canManageClassroom(viewer, assignment.classroom, membership) };
}

/** Live assignments the learner is enrolled in as a student (targeting applies). */
export function learnerAssignmentsWhere(userId: string) {
  return {
    classroom: { archivedAt: null, members: { some: { userId, role: "Student" as const } } },
    AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(new Date())],
  };
}

export async function teachingAssignments(viewer: Viewer, articleId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId: viewer.id },
    select: { orgId: true, role: true },
  });
  const rows = await prisma.assignment.findMany({
    where: {
      articleId,
      classroom: {
        archivedAt: null,
        OR: [{ teacherId: viewer.id }, { orgId: { in: memberships.map((m) => m.orgId) } }],
      },
    },
    select: { id: true, classroom: { select: { name: true, orgId: true, teacherId: true } } },
    orderBy: { createdAt: "asc" },
    take: MAX_TEACHING_ASSIGNMENTS,
  });
  return rows
    .filter((row) =>
      canManageClassroom(viewer, row.classroom, memberships.find((m) => m.orgId === row.classroom.orgId) ?? null),
    )
    .map((row) => ({ assignmentId: row.id, classroomName: row.classroom.name }));
}

/**
 * Everything the reader needs for classroom annotations on an article: the
 * viewer's teaching and learning assignments, their guided prompts, and the
 * viewer's own responses. Callers must have checked article readability.
 */
export async function getReaderAnnotationContext(
  viewer: Viewer,
  articleId: string,
  levelKey: ReadingLevelKey = ORIGINAL_LEVEL,
): Promise<ReaderAnnotationContext> {
  const [teaching, learningRows] = await Promise.all([
    teachingAssignments(viewer, articleId),
    prisma.assignment.findMany({
      where: { articleId, ...learnerAssignmentsWhere(viewer.id) },
      select: { id: true, classroom: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const learning = learningRows.map((row) => ({ assignmentId: row.id, classroomName: row.classroom.name }));
  const teachingIds = new Set(teaching.map((entry) => entry.assignmentId));
  const names = new Map([...learning, ...teaching].map((entry) => [entry.assignmentId, entry.classroomName]));
  if (names.size === 0) return { teaching, learning, guides: [], responses: [] };

  const [guides, responses] = await Promise.all([
    prisma.assignmentAnnotation.findMany({
      where: { assignmentId: { in: [...names.keys()] }, levelKey },
      select: GUIDE_SELECT,
      orderBy: [{ startOffset: "asc" }, { createdAt: "asc" }],
    }),
    learning.length === 0
      ? Promise.resolve([])
      : prisma.assignmentAnnotationResponse.findMany({
          where: { userId: viewer.id, levelKey, assignmentId: { in: learning.map((entry) => entry.assignmentId) } },
          select: RESPONSE_SELECT,
          orderBy: { createdAt: "asc" },
        }),
  ]);
  return {
    teaching,
    learning,
    guides: guides.map((guide) => ({
      ...guide,
      classroomName: names.get(guide.assignmentId) ?? "",
      canEdit: teachingIds.has(guide.assignmentId),
    })),
    responses,
  };
}

// ---------------------------------------------------------------------------
// Teacher prompts
// ---------------------------------------------------------------------------

async function recordPromptAudit(
  audit: AuditFactory,
  action: AuditAction,
  guideId: string,
  assignment: { id: string; classroom: { id: string } },
  tx: Parameters<typeof recordAuditFromRequest>[1],
) {
  await recordAuditFromRequest(
    audit({ action, targetId: guideId, metadata: { assignmentId: assignment.id, classroomId: assignment.classroom.id } }),
    tx,
  );
}

/** Pins a guided prompt to an assignment the viewer manages. */
export async function createGuidedAnnotation(
  viewer: Viewer,
  assignmentId: string,
  input: AnnotationAnchor & { prompt: string },
  audit: AuditFactory,
): Promise<{ ok: true; guide: GuidedAnnotationView } | AnnotationFailure> {
  const access = await assignmentAccess(assignmentId, viewer);
  if (!access) return NOT_FOUND;
  if (!access.manages) return FORBIDDEN;
  if (access.assignment.classroom.archivedAt) return { ok: false, status: 409, reason: "archived" };
  const anchor = normalizeAnchor(input);
  const levelKey = input.levelKey ?? ORIGINAL_LEVEL;
  if (!anchor || !(await levelExists(access.assignment.articleId, levelKey))) {
    return { ok: false, status: 400, reason: "invalid_anchor" };
  }

  const guide = await prisma.$transaction(async (tx) => {
    const row = await tx.assignmentAnnotation.create({
      data: { assignmentId, authorId: viewer.id, ...anchor, levelKey, prompt: input.prompt },
      select: GUIDE_SELECT,
    });
    await recordPromptAudit(audit, AUDIT_ACTIONS.assignmentAnnotationCreated, row.id, access.assignment, tx);
    return row;
  });
  return { ok: true, guide: { ...guide, classroomName: access.assignment.classroom.name, canEdit: true } };
}

async function managedGuide(guideId: string, viewer: Viewer) {
  const guide = await prisma.assignmentAnnotation.findUnique({ where: { id: guideId }, select: { assignmentId: true } });
  if (!guide) return NOT_FOUND;
  const access = await assignmentAccess(guide.assignmentId, viewer);
  if (!access) return NOT_FOUND;
  if (!access.manages) return FORBIDDEN;
  if (access.assignment.classroom.archivedAt) return { ok: false, status: 409, reason: "archived" } as const;
  return { ok: true, assignment: access.assignment } as const;
}

/** Edits a guided prompt's text. */
export async function updateGuidedAnnotation(
  viewer: Viewer,
  guideId: string,
  prompt: string,
  audit: AuditFactory,
): Promise<{ ok: true; guide: GuidedAnnotationView } | AnnotationFailure> {
  const managed = await managedGuide(guideId, viewer);
  if (!managed.ok) return managed;
  const guide = await prisma.$transaction(async (tx) => {
    const row = await tx.assignmentAnnotation.update({ where: { id: guideId }, data: { prompt }, select: GUIDE_SELECT });
    await recordPromptAudit(audit, AUDIT_ACTIONS.assignmentAnnotationUpdated, guideId, managed.assignment, tx);
    return row;
  });
  return { ok: true, guide: { ...guide, classroomName: managed.assignment.classroom.name, canEdit: true } };
}

/** Deletes a guided prompt and the replies to it. */
export async function deleteGuidedAnnotation(
  viewer: Viewer,
  guideId: string,
  audit: AuditFactory,
): Promise<{ ok: true } | AnnotationFailure> {
  const managed = await managedGuide(guideId, viewer);
  if (!managed.ok) return managed;
  await prisma.$transaction(async (tx) => {
    await tx.assignmentAnnotation.delete({ where: { id: guideId } });
    await recordPromptAudit(audit, AUDIT_ACTIONS.assignmentAnnotationDeleted, guideId, managed.assignment, tx);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Learner responses
// ---------------------------------------------------------------------------

export type ResponseInput = {
  annotationId?: string | null;
  anchor?: AnnotationAnchor | null;
  body: string;
};

/** Replies inherit their prompt's level; evidence uses its anchor's level. */
function responseLevel(input: ResponseInput, guideLevel: string | null): string {
  return input.anchor?.levelKey ?? guideLevel ?? ORIGINAL_LEVEL;
}

/**
 * Submits a reply to a guided prompt and/or an evidence highlight for one of
 * the learner's live assignments. 404 for assignments the learner isn't part
 * of and prompts from other assignments.
 */
export async function submitAnnotationResponse(
  viewer: Viewer,
  assignmentId: string,
  input: ResponseInput,
): Promise<{ ok: true; response: AnnotationResponseView } | AnnotationFailure> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, ...learnerAssignmentsWhere(viewer.id) },
    select: { id: true, articleId: true },
  });
  if (!assignment) return NOT_FOUND;
  let guideLevel: string | null = null;
  if (input.annotationId) {
    const guide = await prisma.assignmentAnnotation.findFirst({
      where: { id: input.annotationId, assignmentId },
      select: { levelKey: true },
    });
    if (!guide) return NOT_FOUND;
    guideLevel = guide.levelKey;
  }
  const anchor = input.anchor ? normalizeAnchor(input.anchor) : null;
  const anchorLevelOk = !input.anchor?.levelKey || (await levelExists(assignment.articleId, input.anchor.levelKey));
  if (input.anchor && (!anchor || !anchorLevelOk)) return { ok: false, status: 400, reason: "invalid_anchor" };
  const body = input.body.trim();
  if (!anchor && !body) return { ok: false, status: 400, reason: "empty_response" };

  const response = await prisma.assignmentAnnotationResponse.create({
    data: {
      assignmentId,
      annotationId: input.annotationId ?? null,
      userId: viewer.id,
      body,
      levelKey: responseLevel(input, guideLevel),
      ...(anchor ?? {}),
    },
    select: RESPONSE_SELECT,
  });
  return { ok: true, response };
}

/** Withdraws one of the learner's own responses (others' responses are not found). */
export async function deleteAnnotationResponse(viewer: Viewer, responseId: string): Promise<{ ok: true } | AnnotationFailure> {
  const { count } = await prisma.assignmentAnnotationResponse.deleteMany({ where: { id: responseId, userId: viewer.id } });
  return count === 0 ? NOT_FOUND : { ok: true };
}

// ---------------------------------------------------------------------------
// Teacher review
// ---------------------------------------------------------------------------

export type ReviewResponseRow = AnnotationResponseView & {
  student: { id: string; name: string | null; email: string | null };
};

export type AssignmentAnnotationReview = {
  assignment: { id: string; classroomId: string; classroomName: string; articleId: string; articleTitle: string };
  guides: Array<Omit<GuidedAnnotationView, "classroomName" | "canEdit"> & { responses: ReviewResponseRow[] }>;
  /** Evidence and comments not tied to a prompt. */
  evidence: ReviewResponseRow[];
};

/**
 * Guided prompts with every student's replies and shared evidence for an
 * assignment, for its classroom's managers. 404 when missing; 403 otherwise.
 */
export async function getAssignmentAnnotationReview(
  assignmentId: string,
  viewer: Viewer,
): Promise<{ ok: true; review: AssignmentAnnotationReview } | AnnotationFailure> {
  const access = await assignmentAccess(assignmentId, viewer);
  if (!access) return NOT_FOUND;
  if (!access.manages) return FORBIDDEN;
  const { assignment } = access;
  const [guides, responses] = await Promise.all([
    prisma.assignmentAnnotation.findMany({
      where: { assignmentId },
      select: GUIDE_SELECT,
      orderBy: [{ startOffset: "asc" }, { createdAt: "asc" }],
    }),
    prisma.assignmentAnnotationResponse.findMany({
      where: { assignmentId },
      select: { ...RESPONSE_SELECT, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const rows: ReviewResponseRow[] = responses.map(({ user, ...row }) => ({ ...row, student: user }));
  return {
    ok: true,
    review: {
      assignment: {
        id: assignment.id,
        classroomId: assignment.classroom.id,
        classroomName: assignment.classroom.name,
        articleId: assignment.articleId,
        articleTitle: assignment.article.title,
      },
      guides: guides.map((guide) => ({ ...guide, responses: rows.filter((row) => row.annotationId === guide.id) })),
      evidence: rows.filter((row) => row.annotationId === null),
    },
  };
}
