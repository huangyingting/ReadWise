/**
 * Assignment reading activities (#1304): an optional pre-reading opinion
 * poll and formative Checks for Understanding shown after sections of an
 * assigned article.
 *
 * Classroom managers create them per assignment; students in the assignment
 * audience (student role, targeting and publish state apply) vote and answer.
 * Polls are non-graded and only ever expose the aggregate distribution — after
 * the student votes. A check's answer key is revealed to a student only after
 * they answer it; a first answer is final. Educators can preview the student
 * experience without saving responses.
 *
 * Management changes are audited with ids only; votes and answers are
 * personal data (exported with the account, never audited or logged).
 */
import { prisma } from "@/lib/prisma";
import { recordAuditFromRequest, AUDIT_ACTIONS, type AuditAction, type AuditRequestInput } from "@/lib/security/audit";
import { assignmentAccess, learnerAssignmentsWhere, teachingAssignments } from "./annotations";
import { ORIGINAL_LEVEL } from "@/lib/article-levels/levels";
import { articleHasLevel } from "@/lib/article-levels/variants";

type Viewer = { id: string; role?: string | null };

export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 5;
export const CHECK_OPTIONS_MIN = 2;
export const CHECK_OPTIONS_MAX = 4;

export type PollView = {
  id: string;
  assignmentId: string;
  classroomName: string;
  question: string;
  options: string[];
  /** The viewer's vote, or null. */
  myVote: number | null;
  /** Votes per option; null until the viewer has voted (always shown in preview). */
  distribution: number[] | null;
};

export type CheckView = {
  id: string;
  assignmentId: string;
  afterBlock: number;
  /** Reading level whose blocks `afterBlock` counts (#1303). */
  levelKey: string;
  question: string;
  options: string[];
  /** The viewer's answer with the key, once answered. */
  result: { selectedIndex: number; correct: boolean; correctIndex: number; explanation: string | null } | null;
};

export type ReaderActivities = {
  /** "preview" when an educator previews the student view (responses aren't saved). */
  mode: "student" | "preview" | "none";
  polls: PollView[];
  checks: CheckView[];
};

export type ActivityFailure =
  | { ok: false; status: 400; reason: "invalid_option" | "invalid_activity" }
  | { ok: false; status: 403; reason: "forbidden" }
  | { ok: false; status: 404; reason: "not_found" }
  | { ok: false; status: 409; reason: "already_answered" | "archived" };

type AuditFactory = (entry: { action: AuditAction; targetId: string; metadata: Record<string, unknown> }) => AuditRequestInput;

const NOT_FOUND = { ok: false, status: 404, reason: "not_found" } as const;
const FORBIDDEN = { ok: false, status: 403, reason: "forbidden" } as const;

function parseOptions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((option): option is string => typeof option === "string") : [];
}

async function distributionFor(pollId: string, optionCount: number): Promise<number[]> {
  const counts = Array.from({ length: optionCount }, () => 0);
  const groups = await prisma.assignmentPollVote.groupBy({ by: ["optionIndex"], where: { pollId }, _count: { _all: true } });
  for (const group of groups) {
    if (group.optionIndex >= 0 && group.optionIndex < optionCount) counts[group.optionIndex] = group._count._all;
  }
  return counts;
}

const POLL_SELECT = { id: true, assignmentId: true, question: true, options: true } as const;
const CHECK_SELECT = {
  id: true,
  assignmentId: true,
  afterBlock: true,
  levelKey: true,
  question: true,
  options: true,
  correctIndex: true,
  explanation: true,
} as const;

/**
 * Polls and checks for the reader. Students see their live assignments'
 * activities with their own responses; an educator previewing the student view
 * sees their first teaching assignment of the article — the same one whose
 * reading-level lock the preview applies.
 */
export async function getReaderActivities(
  viewer: Viewer,
  articleId: string,
  options: { preview?: boolean } = {},
): Promise<ReaderActivities> {
  if (options.preview) {
    const [assignment] = await teachingAssignments(viewer, articleId);
    if (!assignment) return { mode: "preview", polls: [], checks: [] };
    const [poll, checks] = await Promise.all([
      prisma.assignmentPoll.findUnique({ where: { assignmentId: assignment.assignmentId }, select: POLL_SELECT }),
      prisma.assignmentCheck.findMany({
        where: { assignmentId: assignment.assignmentId },
        select: CHECK_SELECT,
        orderBy: [{ afterBlock: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const polls: PollView[] = [];
    if (poll) {
      const pollOptions = parseOptions(poll.options);
      polls.push({
        ...poll,
        options: pollOptions,
        classroomName: assignment.classroomName,
        myVote: null,
        distribution: await distributionFor(poll.id, pollOptions.length),
      });
    }
    return {
      mode: "preview",
      polls,
      checks: checks.map((check) => ({
        id: check.id,
        assignmentId: check.assignmentId,
        afterBlock: check.afterBlock,
        levelKey: check.levelKey,
        question: check.question,
        options: parseOptions(check.options),
        result: null,
      })),
    };
  }

  const learning = await prisma.assignment.findMany({
    where: { articleId, ...learnerAssignmentsWhere(viewer.id) },
    select: { id: true, classroom: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (learning.length === 0) return { mode: "none", polls: [], checks: [] };
  const ids = learning.map((assignment) => assignment.id);
  const names = new Map(learning.map((assignment) => [assignment.id, assignment.classroom.name]));

  const [polls, checks] = await Promise.all([
    prisma.assignmentPoll.findMany({
      where: { assignmentId: { in: ids } },
      select: { ...POLL_SELECT, votes: { where: { userId: viewer.id }, select: { optionIndex: true } } },
    }),
    prisma.assignmentCheck.findMany({
      where: { assignmentId: { in: ids } },
      select: { ...CHECK_SELECT, answers: { where: { userId: viewer.id }, select: { selectedIndex: true, correct: true } } },
      orderBy: [{ afterBlock: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const pollViews = await Promise.all(
    polls.map(async ({ votes, ...poll }) => {
      const pollOptions = parseOptions(poll.options);
      const myVote = votes[0]?.optionIndex ?? null;
      return {
        ...poll,
        options: pollOptions,
        classroomName: names.get(poll.assignmentId) ?? "",
        myVote,
        distribution: myVote === null ? null : await distributionFor(poll.id, pollOptions.length),
      };
    }),
  );
  return {
    mode: "student",
    polls: pollViews,
    checks: checks.map(({ answers, correctIndex, explanation, ...check }) => ({
      id: check.id,
      assignmentId: check.assignmentId,
      afterBlock: check.afterBlock,
      levelKey: check.levelKey,
      question: check.question,
      options: parseOptions(check.options),
      result: answers[0] ? { ...answers[0], correctIndex, explanation } : null,
    })),
  };
}

async function learnerCanRespond(viewer: Viewer, assignmentId: string): Promise<boolean> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, ...learnerAssignmentsWhere(viewer.id) },
    select: { id: true },
  });
  return assignment !== null;
}

/** Records (or changes) a student's poll vote and returns the distribution. */
export async function votePoll(
  viewer: Viewer,
  pollId: string,
  optionIndex: number,
): Promise<{ ok: true; myVote: number; distribution: number[] } | ActivityFailure> {
  const poll = await prisma.assignmentPoll.findUnique({ where: { id: pollId }, select: { id: true, assignmentId: true, options: true } });
  if (!poll || !(await learnerCanRespond(viewer, poll.assignmentId))) return NOT_FOUND;
  const pollOptions = parseOptions(poll.options);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= pollOptions.length) {
    return { ok: false, status: 400, reason: "invalid_option" };
  }
  await prisma.assignmentPollVote.upsert({
    where: { pollId_userId: { pollId, userId: viewer.id } },
    create: { pollId, userId: viewer.id, optionIndex },
    update: { optionIndex },
  });
  return { ok: true, myVote: optionIndex, distribution: await distributionFor(pollId, pollOptions.length) };
}

/** Grades a student's first answer to a check and reveals the key. */
export async function answerCheck(
  viewer: Viewer,
  checkId: string,
  selectedIndex: number,
): Promise<{ ok: true; result: NonNullable<CheckView["result"]> } | ActivityFailure> {
  const check = await prisma.assignmentCheck.findUnique({ where: { id: checkId }, select: CHECK_SELECT });
  if (!check || !(await learnerCanRespond(viewer, check.assignmentId))) return NOT_FOUND;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= parseOptions(check.options).length) {
    return { ok: false, status: 400, reason: "invalid_option" };
  }
  const existing = await prisma.assignmentCheckAnswer.findUnique({
    where: { checkId_userId: { checkId, userId: viewer.id } },
    select: { id: true },
  });
  if (existing) return { ok: false, status: 409, reason: "already_answered" };
  const correct = selectedIndex === check.correctIndex;
  await prisma.assignmentCheckAnswer.create({ data: { checkId, userId: viewer.id, selectedIndex, correct } });
  return { ok: true, result: { selectedIndex, correct, correctIndex: check.correctIndex, explanation: check.explanation } };
}

// ---------------------------------------------------------------------------
// Teacher management
// ---------------------------------------------------------------------------

export type AssignmentActivitiesView = {
  assignment: { id: string; classroomName: string; articleId: string };
  poll: (Omit<PollView, "myVote" | "classroomName"> & { distribution: number[]; voters: number }) | null;
  checks: Array<{
    id: string;
    afterBlock: number;
    levelKey: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
    answered: number;
    correctCount: number;
  }>;
};

async function managed(viewer: Viewer, assignmentId: string, forWrite: boolean) {
  const access = await assignmentAccess(assignmentId, viewer);
  if (!access) return NOT_FOUND;
  if (!access.manages) return FORBIDDEN;
  if (forWrite && access.assignment.classroom.archivedAt) return { ok: false, status: 409, reason: "archived" } as const;
  return { ok: true, assignment: access.assignment } as const;
}

/** Poll and checks with aggregate results, for the classroom's managers. */
export async function getAssignmentActivities(
  viewer: Viewer,
  assignmentId: string,
): Promise<{ ok: true; activities: AssignmentActivitiesView } | ActivityFailure> {
  const access = await managed(viewer, assignmentId, false);
  if (!access.ok) return access;
  const [poll, checks] = await Promise.all([
    prisma.assignmentPoll.findUnique({ where: { assignmentId }, select: POLL_SELECT }),
    prisma.assignmentCheck.findMany({
      where: { assignmentId },
      select: { ...CHECK_SELECT, answers: { select: { correct: true } } },
      orderBy: [{ afterBlock: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  let pollView: AssignmentActivitiesView["poll"] = null;
  if (poll) {
    const pollOptions = parseOptions(poll.options);
    const distribution = await distributionFor(poll.id, pollOptions.length);
    pollView = { ...poll, options: pollOptions, distribution, voters: distribution.reduce((sum, count) => sum + count, 0) };
  }
  return {
    ok: true,
    activities: {
      assignment: { id: assignmentId, classroomName: access.assignment.classroom.name, articleId: access.assignment.articleId },
      poll: pollView,
      checks: checks.map(({ answers, options, ...check }) => ({
        ...check,
        options: parseOptions(options),
        answered: answers.length,
        correctCount: answers.filter((answer) => answer.correct).length,
      })),
    },
  };
}

function cleanOptions(options: string[], min: number, max: number): string[] | null {
  const cleaned = options.map((option) => option.trim()).filter(Boolean);
  return cleaned.length >= min && cleaned.length <= max && new Set(cleaned).size === cleaned.length ? cleaned : null;
}

async function audit(
  factory: AuditFactory,
  action: AuditAction,
  targetId: string,
  assignment: { id: string; classroom: { id: string } },
  tx: Parameters<typeof recordAuditFromRequest>[1],
) {
  await recordAuditFromRequest(
    factory({ action, targetId, metadata: { assignmentId: assignment.id, classroomId: assignment.classroom.id } }),
    tx,
  );
}

/** Creates or replaces the assignment's poll; existing votes are cleared when it changes. */
export async function saveAssignmentPoll(
  viewer: Viewer,
  assignmentId: string,
  input: { question: string; options: string[] },
  auditFactory: AuditFactory,
): Promise<{ ok: true; pollId: string } | ActivityFailure> {
  const access = await managed(viewer, assignmentId, true);
  if (!access.ok) return access;
  const options = cleanOptions(input.options, POLL_OPTIONS_MIN, POLL_OPTIONS_MAX);
  const question = input.question.trim();
  if (!options || !question) return { ok: false, status: 400, reason: "invalid_activity" };
  const pollId = await prisma.$transaction(async (tx) => {
    const existing = await tx.assignmentPoll.findUnique({ where: { assignmentId }, select: { id: true } });
    if (existing) await tx.assignmentPollVote.deleteMany({ where: { pollId: existing.id } });
    const poll = await tx.assignmentPoll.upsert({
      where: { assignmentId },
      create: { assignmentId, question, options, createdById: viewer.id },
      update: { question, options },
      select: { id: true },
    });
    await audit(auditFactory, AUDIT_ACTIONS.assignmentPollSaved, poll.id, access.assignment, tx);
    return poll.id;
  });
  return { ok: true, pollId };
}

/** Removes the assignment's poll and its votes. */
export async function deleteAssignmentPoll(
  viewer: Viewer,
  assignmentId: string,
  auditFactory: AuditFactory,
): Promise<{ ok: true } | ActivityFailure> {
  const access = await managed(viewer, assignmentId, true);
  if (!access.ok) return access;
  const poll = await prisma.assignmentPoll.findUnique({ where: { assignmentId }, select: { id: true } });
  if (!poll) return NOT_FOUND;
  await prisma.$transaction(async (tx) => {
    await tx.assignmentPoll.delete({ where: { id: poll.id } });
    await audit(auditFactory, AUDIT_ACTIONS.assignmentPollDeleted, poll.id, access.assignment, tx);
  });
  return { ok: true };
}

/** Adds a Check for Understanding after a reading block. */
export async function addAssignmentCheck(
  viewer: Viewer,
  assignmentId: string,
  input: {
    afterBlock: number;
    question: string;
    options: string[];
    correctIndex: number;
    explanation?: string | null;
    /** Reading level the teacher placed the check in (#1303); defaults to the original. */
    levelKey?: string | null;
  },
  auditFactory: AuditFactory,
): Promise<{ ok: true; checkId: string } | ActivityFailure> {
  const access = await managed(viewer, assignmentId, true);
  if (!access.ok) return access;
  const options = cleanOptions(input.options, CHECK_OPTIONS_MIN, CHECK_OPTIONS_MAX);
  const question = input.question.trim();
  if (
    !options ||
    !question ||
    options.length !== input.options.length ||
    !Number.isInteger(input.correctIndex) ||
    input.correctIndex < 0 ||
    input.correctIndex >= options.length
  ) {
    return { ok: false, status: 400, reason: "invalid_activity" };
  }
  const levelKey = input.levelKey ?? ORIGINAL_LEVEL;
  if (!(await articleHasLevel(access.assignment.articleId, levelKey))) {
    return { ok: false, status: 400, reason: "invalid_activity" };
  }
  const checkId = await prisma.$transaction(async (tx) => {
    const check = await tx.assignmentCheck.create({
      data: {
        assignmentId,
        afterBlock: Math.max(0, Math.floor(input.afterBlock)),
        question,
        options,
        correctIndex: input.correctIndex,
        explanation: input.explanation?.trim() || null,
        levelKey,
        createdById: viewer.id,
      },
      select: { id: true },
    });
    await audit(auditFactory, AUDIT_ACTIONS.assignmentCheckCreated, check.id, access.assignment, tx);
    return check.id;
  });
  return { ok: true, checkId };
}

/** Removes a check and its answers. */
export async function deleteAssignmentCheck(
  viewer: Viewer,
  checkId: string,
  auditFactory: AuditFactory,
): Promise<{ ok: true } | ActivityFailure> {
  const check = await prisma.assignmentCheck.findUnique({ where: { id: checkId }, select: { assignmentId: true } });
  if (!check) return NOT_FOUND;
  const access = await managed(viewer, check.assignmentId, true);
  if (!access.ok) return access;
  await prisma.$transaction(async (tx) => {
    await tx.assignmentCheck.delete({ where: { id: checkId } });
    await audit(auditFactory, AUDIT_ACTIONS.assignmentCheckDeleted, checkId, access.assignment, tx);
  });
  return { ok: true };
}
