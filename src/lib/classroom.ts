/**
 * Classrooms, assignments & teacher workflows (Epic RW-E012 — RW-061).
 *
 * A {@link Classroom} belongs to an {@link Organization} and has one primary
 * teacher plus a roster of students ({@link ClassroomMembership}). Teachers
 * assign articles ({@link Assignment}) — public OR org/private content — and
 * track per-student completion + quiz outcomes ({@link AssignmentCompletion}).
 *
 * Authorization layers on top of `@/lib/org`:
 *   - System admins manage any classroom.
 *   - Org admins (the `org.manage` capability) manage any classroom in their org.
 *   - A classroom's own teacher manages that classroom.
 *   - Students only receive assignments and report their own completion.
 *
 * Aggregated, privacy-aware class analytics live in `@/lib/tenant-analytics`;
 * this module owns the CRUD + raw progress fetch they build on.
 */
import {
  AssignmentStatus,
  type Assignment,
  type Classroom,
  type ClassroomMembership,
  type ClassroomRole,
  type MembershipRole,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES } from "@/lib/rbac";
import { hasOrgCapability, isSystemAdmin } from "@/lib/org";

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export type ClassroomViewer = { id?: string | null; role?: string | null } | null | undefined;
type ClassroomOwnership = { teacherId: string; orgId: string } | null | undefined;
type OrgMembership = { role: MembershipRole } | null | undefined;

/** True if the viewer may create classrooms in an org (OrgAdmin or Teacher). */
export function canCreateClassroom(
  viewer: ClassroomViewer,
  membership: OrgMembership,
): boolean {
  if (isSystemAdmin(viewer?.role)) return true;
  return hasOrgCapability(membership, CAPABILITIES.classroomManage);
}

/**
 * True if the viewer may MANAGE a classroom (edit roster, assign, view full
 * progress): a system admin, the org's admin, or the classroom's own teacher.
 */
export function canManageClassroom(
  viewer: ClassroomViewer,
  classroom: ClassroomOwnership,
  membership: OrgMembership,
): boolean {
  if (!classroom) return false;
  if (isSystemAdmin(viewer?.role)) return true;
  if (viewer?.id && classroom.teacherId === viewer.id) return true;
  return hasOrgCapability(membership, CAPABILITIES.orgManage);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getClassroom(classroomId: string): Promise<Classroom | null> {
  return prisma.classroom.findUnique({ where: { id: classroomId } });
}

/** Classrooms in an org, newest first. */
export function listClassroomsForOrg(orgId: string): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Classrooms a teacher leads — either as the primary `teacherId` or via a
 * Teacher {@link ClassroomMembership}. De-duplicated, newest first.
 */
export async function listClassroomsForTeacher(
  teacherId: string,
): Promise<Classroom[]> {
  const rows = await prisma.classroom.findMany({
    where: {
      OR: [
        { teacherId },
        { members: { some: { userId: teacherId, role: "Teacher" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return rows;
}

/** A student's classrooms (any role membership). */
export function listClassroomsForStudent(userId: string): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "desc" },
  });
}

export type ClassroomMemberRow = {
  userId: string;
  role: ClassroomRole;
  name: string | null;
  email: string | null;
  image: string | null;
};

/** Roster of a classroom (teachers first, then students), joined with users. */
export async function listClassroomMembers(
  classroomId: string,
): Promise<ClassroomMemberRow[]> {
  const rows = await prisma.classroomMembership.findMany({
    where: { classroomId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    name: r.user.name,
    email: r.user.email,
    image: r.user.image,
  }));
}

// ---------------------------------------------------------------------------
// Writes — classroom & roster
// ---------------------------------------------------------------------------

export type CreateClassroomInput = { orgId: string; name: string; teacherId: string };

/**
 * Creates a classroom and seats its primary teacher as a Teacher member, in one
 * transaction.
 */
export async function createClassroom(
  input: CreateClassroomInput,
): Promise<Classroom> {
  return prisma.$transaction(async (tx) => {
    const classroom = await tx.classroom.create({
      data: { orgId: input.orgId, name: input.name.trim(), teacherId: input.teacherId },
    });
    await tx.classroomMembership.create({
      data: { classroomId: classroom.id, userId: input.teacherId, role: "Teacher" },
    });
    return classroom;
  });
}

/** Adds (or re-roles) a member of a classroom. Idempotent via the unique key. */
export function addClassroomMember(
  classroomId: string,
  userId: string,
  role: ClassroomRole = "Student",
): Promise<ClassroomMembership> {
  return prisma.classroomMembership.upsert({
    where: { classroomId_userId: { classroomId, userId } },
    update: { role },
    create: { classroomId, userId, role },
  });
}

/** Removes a member from a classroom. */
export async function removeClassroomMember(
  classroomId: string,
  userId: string,
): Promise<void> {
  await prisma.classroomMembership.deleteMany({ where: { classroomId, userId } });
}

// ---------------------------------------------------------------------------
// Writes — assignments
// ---------------------------------------------------------------------------

export type AssignArticleInput = {
  classroomId: string;
  articleId: string;
  dueDate?: Date | null;
  instructions?: string | null;
};

/** Assigns an article to a classroom. */
export function assignArticle(input: AssignArticleInput): Promise<Assignment> {
  return prisma.assignment.create({
    data: {
      classroomId: input.classroomId,
      articleId: input.articleId,
      dueDate: input.dueDate ?? null,
      instructions: input.instructions?.trim() || null,
    },
  });
}

/** Deletes an assignment (cascades its completions). */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  await prisma.assignment.deleteMany({ where: { id: assignmentId } });
}

/**
 * Resolves an assignment ONLY if `studentId` is enrolled in its classroom.
 * Returns null when the assignment doesn't exist OR the user isn't a member —
 * so a student can never report completion on an assignment that isn't theirs.
 */
export async function getStudentAssignmentContext(
  assignmentId: string,
  studentId: string,
): Promise<{ assignmentId: string; classroomId: string } | null> {
  const assignment = await prisma.assignment.findFirst({
    where: {
      id: assignmentId,
      classroom: { members: { some: { userId: studentId } } },
    },
    select: { id: true, classroomId: true },
  });
  return assignment
    ? { assignmentId: assignment.id, classroomId: assignment.classroomId }
    : null;
}

export type RecordCompletionInput = {
  status?: AssignmentStatus;
  quizScore?: number | null;
};

/**
 * Records (upserts) a student's progress on an assignment. When the status is
 * COMPLETED, `completedAt` is stamped (idempotently). A quiz score, if provided,
 * is clamped to 0–100.
 */
export async function recordAssignmentCompletion(
  assignmentId: string,
  studentId: string,
  input: RecordCompletionInput = {},
) {
  const status = input.status ?? AssignmentStatus.COMPLETED;
  const quizScore =
    input.quizScore == null
      ? undefined
      : Math.min(100, Math.max(0, Math.round(input.quizScore)));
  const completedAt = status === AssignmentStatus.COMPLETED ? new Date() : null;
  return prisma.assignmentCompletion.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    update: {
      status,
      ...(quizScore === undefined ? {} : { quizScore }),
      completedAt,
    },
    create: {
      assignmentId,
      studentId,
      status,
      quizScore: quizScore ?? null,
      completedAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Student-facing reads
// ---------------------------------------------------------------------------

export type StudentAssignment = {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  articleId: string;
  articleTitle: string;
  dueDate: Date | null;
  instructions: string | null;
  status: AssignmentStatus;
  quizScore: number | null;
  completedAt: Date | null;
};

/**
 * A student's assigned readings across all their classrooms, with the student's
 * OWN completion status. Sorted by due date (soonest first, undated last) then
 * newest. Only the requesting student's completion is included — no peers'.
 */
export async function listAssignmentsForStudent(
  studentId: string,
): Promise<StudentAssignment[]> {
  const rows = await prisma.assignment.findMany({
    where: { classroom: { members: { some: { userId: studentId } } } },
    include: {
      classroom: { select: { id: true, name: true } },
      article: { select: { id: true, title: true } },
      completions: { where: { studentId }, take: 1 },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  const mapped: StudentAssignment[] = rows.map((a) => {
    const mine = a.completions[0];
    return {
      assignmentId: a.id,
      classroomId: a.classroom.id,
      classroomName: a.classroom.name,
      articleId: a.article.id,
      articleTitle: a.article.title,
      dueDate: a.dueDate,
      instructions: a.instructions,
      status: mine?.status ?? AssignmentStatus.ASSIGNED,
      quizScore: mine?.quizScore ?? null,
      completedAt: mine?.completedAt ?? null,
    };
  });
  return mapped.sort((x, y) => {
    const dx = x.dueDate ? x.dueDate.getTime() : Number.POSITIVE_INFINITY;
    const dy = y.dueDate ? y.dueDate.getTime() : Number.POSITIVE_INFINITY;
    return dx - dy;
  });
}

// ---------------------------------------------------------------------------
// Raw progress data (consumed by tenant-analytics)
// ---------------------------------------------------------------------------

export type ClassroomProgressStudent = { userId: string; name: string | null; email: string | null };
export type ClassroomProgressAssignment = {
  id: string;
  articleId: string;
  articleTitle: string;
  dueDate: Date | null;
  createdAt: Date;
};
export type ClassroomProgressCompletion = {
  assignmentId: string;
  studentId: string;
  status: AssignmentStatus;
  quizScore: number | null;
  completedAt: Date | null;
};
export type ClassroomProgressData = {
  classroom: { id: string; name: string; orgId: string; teacherId: string };
  students: ClassroomProgressStudent[];
  assignments: ClassroomProgressAssignment[];
  completions: ClassroomProgressCompletion[];
};

/**
 * Fetches the raw matrix the class-progress / analytics layer aggregates over:
 * the roster's STUDENTS, the classroom's assignments, and every student
 * completion. Returns null when the classroom doesn't exist.
 */
export async function getClassroomProgressData(
  classroomId: string,
): Promise<ClassroomProgressData | null> {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, name: true, orgId: true, teacherId: true },
  });
  if (!classroom) return null;

  const [memberRows, assignmentRows, completionRows] = await Promise.all([
    prisma.classroomMembership.findMany({
      where: { classroomId, role: "Student" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.assignment.findMany({
      where: { classroomId },
      include: { article: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.assignmentCompletion.findMany({
      where: { assignment: { classroomId } },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        quizScore: true,
        completedAt: true,
      },
    }),
  ]);

  return {
    classroom,
    students: memberRows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
    })),
    assignments: assignmentRows.map((a) => ({
      id: a.id,
      articleId: a.articleId,
      articleTitle: a.article.title,
      dueDate: a.dueDate,
      createdAt: a.createdAt,
    })),
    completions: completionRows.map((c) => ({
      assignmentId: c.assignmentId,
      studentId: c.studentId,
      status: c.status,
      quizScore: c.quizScore,
      completedAt: c.completedAt,
    })),
  };
}
