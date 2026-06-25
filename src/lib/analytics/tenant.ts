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
 * `@/lib/analytics/events` (`pruneOldEvents`, `deleteEventsForUser`). Class analytics
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
import { averageRounded as average, wholePercentage as rate } from "@/lib/aggregation";

export type AnalyticsViewerRole = "learner" | "teacher" | "orgAdmin" | "systemAdmin";

export type AnalyticsAccess = {
	scope: "self" | "classroom" | "org" | "global" | "none";
	individualData: boolean;
};

export function analyticsAccessFor(role: AnalyticsViewerRole): AnalyticsAccess {
	switch (role) {
		case "systemAdmin":
			return { scope: "global", individualData: true };
		case "orgAdmin":
			return { scope: "org", individualData: false };
		case "teacher":
			return { scope: "classroom", individualData: true };
		case "learner":
		default:
			return { scope: "self", individualData: false };
	}
}

export type LearnerDataRequest = {
	viewerRole: AnalyticsViewerRole;
	sameUser: boolean;
	targetInViewerClassroom: boolean;
	targetInViewerOrg: boolean;
};

export type LearnerDataDecision = {
	allowed: boolean;
	individual: boolean;
};

export function learnerDataAccess(req: LearnerDataRequest): LearnerDataDecision {
	switch (req.viewerRole) {
		case "systemAdmin":
			return { allowed: true, individual: true };
		case "orgAdmin":
			return { allowed: req.targetInViewerOrg, individual: false };
		case "teacher":
			return {
				allowed: req.sameUser || req.targetInViewerClassroom,
				individual: req.sameUser || req.targetInViewerClassroom,
			};
		case "learner":
		default:
			return { allowed: req.sameUser, individual: req.sameUser };
	}
}

export type AssignmentAggregate = {
	assignmentId: string;
	articleTitle: string;
	assigned: number;
	completed: number;
	inProgress: number;
	notStarted: number;
	completionRate: number;
	averageQuizScore: number | null;
};

export type StudentAggregate = {
	studentId: string;
	name: string | null;
	email: string | null;
	completed: number;
	total: number;
	completionRate: number;
	averageQuizScore: number | null;
};

export type ClassroomAnalytics = {
	classroomId: string;
	classroomName: string;
	studentCount: number;
	assignmentCount: number;
	totalExpected: number;
	totalCompleted: number;
	completionRate: number;
	averageQuizScore: number | null;
	perAssignment: AssignmentAggregate[];
	perStudent: StudentAggregate[];
	redacted: boolean;
};

export function aggregateClassroom(data: ClassroomProgressData): ClassroomAnalytics {
	const students = data.students;
	const assignments = data.assignments;
	const studentIds = new Set(students.map((s) => s.userId));

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

export function redactIndividualData(
	analytics: ClassroomAnalytics,
): ClassroomAnalytics {
	if (analytics.perStudent.length === 0 && analytics.redacted) return analytics;
	return { ...analytics, perStudent: [], redacted: true };
}

export function applyAnalyticsAccess(
	analytics: ClassroomAnalytics,
	access: AnalyticsAccess,
): ClassroomAnalytics {
	return access.individualData ? analytics : redactIndividualData(analytics);
}

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

export async function getClassroomAnalytics(
	classroomId: string,
	role: AnalyticsViewerRole,
): Promise<ClassroomAnalytics | null> {
	const data = await getClassroomProgressData(classroomId);
	if (!data) return null;
	const analytics = aggregateClassroom(data);
	return applyAnalyticsAccess(analytics, analyticsAccessFor(role));
}