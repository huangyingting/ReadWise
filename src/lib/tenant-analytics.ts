/**
 * Tenant-aware analytics & privacy rules (Epic RW-E012 — RW-063).
 *
 * Classroom/organization analytics must balance teacher/admin visibility with
 * learner privacy. This module is the single source of truth for:
 *   1. WHO can see WHAT (the access model — pure, role-relationship based).
 *   2. Class-level AGGREGATION that never exposes more individual learner data
 *      than the viewer's role allows.
 *   3. REDACTION of out-of-scope individual data (org admins get aggregates, not
 *      named per-learner rows).
 *
 * Visibility matrix (see `docs/multi-tenancy.md` for the full table):
 *   - learner      → own data only (`self`).
 *   - teacher      → their classroom, INCLUDING per-student rows (pedagogical).
 *   - org admin    → their org, AGGREGATED only (no named per-learner rows).
 *   - system admin → everything, unredacted.
 *
 * Data retention & export: per-event retention/erasure is enforced by
 * `@/lib/analytics` (`pruneOldEvents`, `deleteEventsForUser`). Class analytics
 * are DERIVED (computed on read from AssignmentCompletion), so erasing a learner
 * removes them from aggregates automatically once their rows cascade-delete.
 *
 * The aggregation functions are PURE (take raw rows, return numbers) so they are
 * unit-testable without a DB.
 */
import { AssignmentStatus } from "@prisma/client";
import { isSystemAdmin } from "@/lib/org";
import {
  getClassroomProgressData,
  type ClassroomProgressData,
} from "@/lib/classroom";

// ---------------------------------------------------------------------------
// Access model
// ---------------------------------------------------------------------------

/** The analytics-visibility role a viewer holds relative to the data. */
export type AnalyticsViewerRole = "learner" | "teacher" | "orgAdmin" | "systemAdmin";

/** What a viewer role is allowed to see. */
export type AnalyticsAccess = {
  /** The breadth of data the role may read. */
  scope: "self" | "classroom" | "org" | "global" | "none";
  /** May the viewer see NAMED individual learner rows (vs. aggregates only)? */
  individualData: boolean;
};

/** Resolves the visibility envelope for an analytics viewer role. */
export function analyticsAccessFor(role: AnalyticsViewerRole): AnalyticsAccess {
  switch (role) {
    case "systemAdmin":
      return { scope: "global", individualData: true };
    case "orgAdmin":
      // Org admins steward the tenant but see AGGREGATES, not named learners.
      return { scope: "org", individualData: false };
    case "teacher":
      // A teacher needs per-student visibility for the classes they teach.
      return { scope: "classroom", individualData: true };
    case "learner":
    default:
      return { scope: "self", individualData: false };
  }
}

/** A learner-data access request: the relationship between viewer and target. */
export type LearnerDataRequest = {
  viewerRole: AnalyticsViewerRole;
  /** True when the viewer IS the target learner. */
  sameUser: boolean;
  /** True when the target learner is in a classroom the viewer teaches. */
  targetInViewerClassroom: boolean;
  /** True when the target learner belongs to the viewer's organization. */
  targetInViewerOrg: boolean;
};

/** A learner-data access decision. */
export type LearnerDataDecision = {
  allowed: boolean;
  /** When allowed, whether the viewer may see this learner's INDIVIDUAL data. */
  individual: boolean;
};

/**
 * Decides whether a viewer may read a specific learner's analytics, and whether
 * that includes individual (named) data. Deny-by-default for any relationship
 * the role doesn't cover.
 */
export function learnerDataAccess(req: LearnerDataRequest): LearnerDataDecision {
  switch (req.viewerRole) {
    case "systemAdmin":
      return { allowed: true, individual: true };
    case "orgAdmin":
      // Org-scoped, aggregated only — never an individual learner's record.
      return { allowed: req.targetInViewerOrg, individual: false };
    case "teacher":
      // Individual data, but only for learners in the teacher's own classroom.
      return {
        allowed: req.sameUser || req.targetInViewerClassroom,
        individual: req.sameUser || req.targetInViewerClassroom,
      };
    case "learner":
    default:
      return { allowed: req.sameUser, individual: req.sameUser };
  }
}

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

export type AssignmentAggregate = {
  assignmentId: string;
  articleTitle: string;
  assigned: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  completionRate: number; // 0–100
  averageQuizScore: number | null;
};

export type StudentAggregate = {
  studentId: string;
  name: string | null;
  email: string | null;
  completed: number;
  total: number;
  completionRate: number; // 0–100
  averageQuizScore: number | null;
};

export type ClassroomAnalytics = {
  classroomId: string;
  classroomName: string;
  studentCount: number;
  assignmentCount: number;
  /** studentCount × assignmentCount. */
  totalExpected: number;
  totalCompleted: number;
  completionRate: number; // 0–100
  averageQuizScore: number | null;
  perAssignment: AssignmentAggregate[];
  /** Named per-student rows. EMPTY when the analytics have been redacted. */
  perStudent: StudentAggregate[];
  /** True when individual learner rows were stripped (aggregate-only view). */
  redacted: boolean;
};

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

/**
 * Aggregates a classroom's raw progress matrix into class-, assignment- and
 * student-level numbers. PURE: deterministic over its inputs, no I/O. Missing
 * completion rows count as "not started" (a student who never opened the
 * assignment), so the denominator is always studentCount × assignmentCount.
 */
export function aggregateClassroom(data: ClassroomProgressData): ClassroomAnalytics {
  const students = data.students;
  const assignments = data.assignments;
  const studentIds = new Set(students.map((s) => s.userId));

  // Index completions by assignment and by student (only count enrolled
  // students so a stale completion from a removed student is ignored).
  const byAssignment = new Map<string, ClassroomProgressData["completions"]>();
  const byStudent = new Map<string, ClassroomProgressData["completions"]>();
  const push = (
    map: Map<string, ClassroomProgressData["completions"]>,
    key: string,
    value: ClassroomProgressData["completions"][number],
  ) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const c of data.completions) {
    if (!studentIds.has(c.studentId)) continue;
    push(byAssignment, c.assignmentId, c);
    push(byStudent, c.studentId, c);
  }

  const studentCount = students.length;
  const assignmentCount = assignments.length;

  const perAssignment: AssignmentAggregate[] = assignments.map((a) => {
    const rows = byAssignment.get(a.id) ?? [];
    let completed = 0;
    let inProgress = 0;
    const scores: number[] = [];
    for (const r of rows) {
      if (r.status === AssignmentStatus.COMPLETED) completed++;
      else if (r.status === AssignmentStatus.IN_PROGRESS) inProgress++;
      if (r.quizScore != null) scores.push(r.quizScore);
    }
    const notStarted = Math.max(0, studentCount - completed - inProgress);
    return {
      assignmentId: a.id,
      articleTitle: a.articleTitle,
      assigned: studentCount,
      completed,
      inProgress,
      notStarted,
      completionRate: rate(completed, studentCount),
      averageQuizScore: average(scores),
    };
  });

  const perStudent: StudentAggregate[] = students.map((s) => {
    const rows = byStudent.get(s.userId) ?? [];
    let completed = 0;
    const scores: number[] = [];
    for (const r of rows) {
      if (r.status === AssignmentStatus.COMPLETED) completed++;
      if (r.quizScore != null) scores.push(r.quizScore);
    }
    return {
      studentId: s.userId,
      name: s.name,
      email: s.email,
      completed,
      total: assignmentCount,
      completionRate: rate(completed, assignmentCount),
      averageQuizScore: average(scores),
    };
  });

  const totalExpected = studentCount * assignmentCount;
  const totalCompleted = perStudent.reduce((acc, s) => acc + s.completed, 0);
  const allScores: number[] = data.completions
    .filter((c) => studentIds.has(c.studentId) && c.quizScore != null)
    .map((c) => c.quizScore as number);

  return {
    classroomId: data.classroom.id,
    classroomName: data.classroom.name,
    studentCount,
    assignmentCount,
    totalExpected,
    totalCompleted,
    completionRate: rate(totalCompleted, totalExpected),
    averageQuizScore: average(allScores),
    perAssignment,
    perStudent,
    redacted: false,
  };
}

/**
 * Strips named per-student rows from a classroom analytics object, leaving only
 * class- and assignment-level aggregates. Used to present org-admin (or any
 * aggregate-only) views without exposing individual learner identities.
 */
export function redactIndividualData(
  analytics: ClassroomAnalytics,
): ClassroomAnalytics {
  if (analytics.perStudent.length === 0 && analytics.redacted) return analytics;
  return { ...analytics, perStudent: [], redacted: true };
}

/**
 * Applies the viewer's visibility envelope to a computed analytics object: an
 * aggregate-only role (org admin) gets individual rows redacted; a role with
 * individual access (teacher/system admin) gets the full object.
 */
export function applyAnalyticsAccess(
  analytics: ClassroomAnalytics,
  access: AnalyticsAccess,
): ClassroomAnalytics {
  return access.individualData ? analytics : redactIndividualData(analytics);
}

// ---------------------------------------------------------------------------
// Composed read (DB-backed)
// ---------------------------------------------------------------------------

/**
 * Maps a concrete viewer (session user + their org membership relative to the
 * classroom) onto an {@link AnalyticsViewerRole}. The privacy distinction is
 * deliberate:
 *   - a system admin is global;
 *   - the classroom's OWN teacher (primary `teacherId`) sees per-student rows;
 *   - an org admin (manages the org but isn't the teacher) is `orgAdmin` and
 *     gets AGGREGATE-only data — never named individual learners;
 *   - everyone else is a learner (own data only).
 *
 * Note: org-admin precedence is intentional — an OrgAdmin can MANAGE a classroom
 * (write) but must not read individual learner records, so they are NOT promoted
 * to `teacher` here.
 */
export function viewerRoleForClassroom(input: {
  viewer: { id?: string | null; role?: string | null } | null | undefined;
  classroom: { teacherId: string; orgId: string } | null | undefined;
  isOrgAdmin: boolean;
}): AnalyticsViewerRole {
  if (isSystemAdmin(input.viewer?.role)) return "systemAdmin";
  if (input.viewer?.id && input.classroom?.teacherId === input.viewer.id) {
    return "teacher";
  }
  if (input.isOrgAdmin) return "orgAdmin";
  return "learner";
}

/**
 * Loads a classroom's analytics already scoped to the viewer's role: fetches the
 * raw progress matrix, aggregates it, and applies the role's visibility envelope
 * (redacting individual rows for aggregate-only roles). Returns null when the
 * classroom doesn't exist. Callers MUST still authorize access to the classroom
 * before exposing this (e.g. via `canManageClassroom`).
 */
export async function getClassroomAnalytics(
  classroomId: string,
  role: AnalyticsViewerRole,
): Promise<ClassroomAnalytics | null> {
  const data = await getClassroomProgressData(classroomId);
  if (!data) return null;
  const analytics = aggregateClassroom(data);
  return applyAnalyticsAccess(analytics, analyticsAccessFor(role));
}
