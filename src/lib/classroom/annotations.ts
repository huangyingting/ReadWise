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
import { prisma } from "@/lib/prisma";
import { validateAnchor } from "@/lib/annotations";
import { AUDIT_ACTIONS } from "@/lib/security/audit";
import {
  NOT_FOUND,
  learnerAssignmentsWhere,
  recordAssignmentAudit,
  requireManagedAssignment,
  teachingAssignments,
  type AssignmentAuditFactory,
  type ManagedAccessFailure,
  type Viewer,
} from "./assignment-access";
import { ANNOTATION_QUOTE_MAX_LENGTH } from "./annotation-limits";
import { ORIGINAL_LEVEL, type ReadingLevelKey } from "@/lib/article-levels/levels";
import { articleHasLevel } from "@/lib/article-levels/variants";

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
  | ManagedAccessFailure;

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

/**
 * Everything the reader needs for classroom annotations on an article: the
 * viewer's teaching and learning assignments, their guided prompts, and the
 * viewer's own responses, across every reading level (each item carries its
 * `levelKey`; the reader paints only the current level's anchors inline).
 * Callers must have checked article readability.
 */
export async function getReaderAnnotationContext(viewer: Viewer, articleId: string): Promise<ReaderAnnotationContext> {
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
      where: { assignmentId: { in: [...names.keys()] } },
      select: GUIDE_SELECT,
      orderBy: [{ startOffset: "asc" }, { createdAt: "asc" }],
    }),
    learning.length === 0
      ? Promise.resolve([])
      : prisma.assignmentAnnotationResponse.findMany({
          where: { userId: viewer.id, assignmentId: { in: learning.map((entry) => entry.assignmentId) } },
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

/** Pins a guided prompt to an assignment the viewer manages. */
export async function createGuidedAnnotation(
  viewer: Viewer,
  assignmentId: string,
  input: AnnotationAnchor & { prompt: string },
  audit: AssignmentAuditFactory,
): Promise<{ ok: true; guide: GuidedAnnotationView } | AnnotationFailure> {
  const access = await requireManagedAssignment(viewer, assignmentId, { forWrite: true });
  if (!access.ok) return access;
  const anchor = normalizeAnchor(input);
  const levelKey = input.levelKey ?? ORIGINAL_LEVEL;
  if (!anchor || !(await articleHasLevel(access.assignment.articleId, levelKey))) {
    return { ok: false, status: 400, reason: "invalid_anchor" };
  }

  const guide = await prisma.$transaction(async (tx) => {
    const row = await tx.assignmentAnnotation.create({
      data: { assignmentId, authorId: viewer.id, ...anchor, levelKey, prompt: input.prompt },
      select: GUIDE_SELECT,
    });
    await recordAssignmentAudit(audit, AUDIT_ACTIONS.assignmentAnnotationCreated, row.id, access.assignment, tx);
    return row;
  });
  return { ok: true, guide: { ...guide, classroomName: access.assignment.classroom.name, canEdit: true } };
}

async function managedGuide(guideId: string, viewer: Viewer) {
  const guide = await prisma.assignmentAnnotation.findUnique({ where: { id: guideId }, select: { assignmentId: true } });
  if (!guide) return NOT_FOUND;
  return requireManagedAssignment(viewer, guide.assignmentId, { forWrite: true });
}

/** Edits a guided prompt's text. */
export async function updateGuidedAnnotation(
  viewer: Viewer,
  guideId: string,
  prompt: string,
  audit: AssignmentAuditFactory,
): Promise<{ ok: true; guide: GuidedAnnotationView } | AnnotationFailure> {
  const managed = await managedGuide(guideId, viewer);
  if (!managed.ok) return managed;
  const guide = await prisma.$transaction(async (tx) => {
    const row = await tx.assignmentAnnotation.update({ where: { id: guideId }, data: { prompt }, select: GUIDE_SELECT });
    await recordAssignmentAudit(audit, AUDIT_ACTIONS.assignmentAnnotationUpdated, guideId, managed.assignment, tx);
    return row;
  });
  return { ok: true, guide: { ...guide, classroomName: managed.assignment.classroom.name, canEdit: true } };
}

/** Deletes a guided prompt and the replies to it. */
export async function deleteGuidedAnnotation(
  viewer: Viewer,
  guideId: string,
  audit: AssignmentAuditFactory,
): Promise<{ ok: true } | AnnotationFailure> {
  const managed = await managedGuide(guideId, viewer);
  if (!managed.ok) return managed;
  await prisma.$transaction(async (tx) => {
    await tx.assignmentAnnotation.delete({ where: { id: guideId } });
    await recordAssignmentAudit(audit, AUDIT_ACTIONS.assignmentAnnotationDeleted, guideId, managed.assignment, tx);
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
  const anchorLevelOk = !input.anchor?.levelKey || (await articleHasLevel(assignment.articleId, input.anchor.levelKey));
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
  const access = await requireManagedAssignment(viewer, assignmentId, { forWrite: false });
  if (!access.ok) return access;
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
