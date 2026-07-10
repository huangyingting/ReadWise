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
 * Visibility matrix (see `docs/access/multi-tenancy.md` for the full table):
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
import { isSystemAdmin } from "@/lib/org/guards";
import {
	getClassroomProgressData,
	type ClassroomProgressData,
} from "@/lib/classroom/progress";
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

export type ClassroomAnalyticsFilters = {
	assignmentId?: string;
	studentId?: string;
};

export type CompletionDrilldownRow = {
	assignmentId: string;
	articleTitle: string;
	studentId: string;
	name: string | null;
	email: string | null;
	status: AssignmentStatus;
	quizScore: number | null;
	dueDate: Date | null;
	completedAt: Date | null;
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
	drilldown: {
		filters: ClassroomAnalyticsFilters;
		rows: CompletionDrilldownRow[];
	} | null;
	redacted: boolean;
};

type CompletionRow = ClassroomProgressData["completions"][number];
type CompletionIndex = Map<string, CompletionRow[]>;

function addCompletion(index: CompletionIndex, key: string, completion: CompletionRow): void {
	const list = index.get(key);
	if (list) list.push(completion);
	else index.set(key, [completion]);
}

function collectRosterCompletions(
	completions: CompletionRow[],
	studentIds: Set<string>,
): {
	byAssignment: CompletionIndex;
	byStudent: CompletionIndex;
	allScores: number[];
} {
	const byAssignment: CompletionIndex = new Map();
	const byStudent: CompletionIndex = new Map();
	const allScores: number[] = [];

	for (const completion of completions) {
		if (!studentIds.has(completion.studentId)) continue;
		addCompletion(byAssignment, completion.assignmentId, completion);
		addCompletion(byStudent, completion.studentId, completion);
		if (completion.quizScore != null) allScores.push(completion.quizScore);
	}

	return { byAssignment, byStudent, allScores };
}

function assignmentCounts(rows: CompletionRow[]): {
	completed: number;
	inProgress: number;
	scores: number[];
} {
	let completed = 0;
	let inProgress = 0;
	const scores: number[] = [];

	for (const row of rows) {
		if (row.status === AssignmentStatus.COMPLETED) completed++;
		else if (row.status === AssignmentStatus.IN_PROGRESS) inProgress++;
		if (row.quizScore != null) scores.push(row.quizScore);
	}

	return { completed, inProgress, scores };
}

function studentCounts(rows: CompletionRow[]): { completed: number; scores: number[] } {
	let completed = 0;
	const scores: number[] = [];

	for (const row of rows) {
		if (row.status === AssignmentStatus.COMPLETED) completed++;
		if (row.quizScore != null) scores.push(row.quizScore);
	}

	return { completed, scores };
}

export function aggregateClassroom(
	data: ClassroomProgressData,
	filters: ClassroomAnalyticsFilters = {},
): ClassroomAnalytics {
	const students = filters.studentId
		? data.students.filter((s) => s.userId === filters.studentId)
		: data.students;
	const assignments = filters.assignmentId
		? data.assignments.filter((a) => a.id === filters.assignmentId)
		: data.assignments;
	const studentIds = new Set(students.map((s) => s.userId));
	const assignmentIds = new Set(assignments.map((a) => a.id));
	const scopedCompletions = data.completions.filter(
		(completion) =>
			studentIds.has(completion.studentId) &&
			assignmentIds.has(completion.assignmentId),
	);
	const { byAssignment, byStudent, allScores } = collectRosterCompletions(
		scopedCompletions,
		studentIds,
	);

	const studentCount = students.length;
	const assignmentCount = assignments.length;

	const perAssignment: AssignmentAggregate[] = assignments.map((a) => {
		const rows = byAssignment.get(a.id) ?? [];
		const { completed, inProgress, scores } = assignmentCounts(rows);
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
		const { completed, scores } = studentCounts(rows);
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
		drilldown: buildDrilldownRows({ students, assignments, completions: scopedCompletions, filters }),
		redacted: false,
	};
}

function buildDrilldownRows({
	students,
	assignments,
	completions,
	filters,
}: {
	students: ClassroomProgressData["students"];
	assignments: ClassroomProgressData["assignments"];
	completions: CompletionRow[];
	filters: ClassroomAnalyticsFilters;
}): ClassroomAnalytics["drilldown"] {
	if (!filters.assignmentId && !filters.studentId) return null;

	const completionByPair = new Map<string, CompletionRow>();
	for (const completion of completions) {
		completionByPair.set(`${completion.assignmentId}:${completion.studentId}`, completion);
	}

	const rows: CompletionDrilldownRow[] = [];
	for (const assignment of assignments) {
		for (const student of students) {
			const completion = completionByPair.get(`${assignment.id}:${student.userId}`);
			rows.push({
				assignmentId: assignment.id,
				articleTitle: assignment.articleTitle,
				studentId: student.userId,
				name: student.name,
				email: student.email,
				status: completion?.status ?? AssignmentStatus.ASSIGNED,
				quizScore: completion?.quizScore ?? null,
				dueDate: assignment.dueDate,
				completedAt: completion?.completedAt ?? null,
			});
		}
	}
	return { filters, rows };
}

export function redactIndividualData(
	analytics: ClassroomAnalytics,
): ClassroomAnalytics {
	if (analytics.perStudent.length === 0 && analytics.redacted) return analytics;
	return { ...analytics, perStudent: [], drilldown: null, redacted: true };
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
	filters: ClassroomAnalyticsFilters = {},
): Promise<ClassroomAnalytics | null> {
	const data = await getClassroomProgressData(classroomId);
	if (!data) return null;
	const analytics = aggregateClassroom(data, filters);
	return applyAnalyticsAccess(analytics, analyticsAccessFor(role));
}