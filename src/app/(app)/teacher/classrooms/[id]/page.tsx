import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { AssignmentCompletionSource } from "@prisma/client";
import { requireSession } from "@/lib/session";
import {
  getClassroom,
  listClassroomAssignmentMeta,
  listClassroomMembers,
  searchAssignableArticleOptions,
  searchClassroomStudentCandidates,
} from "@/lib/classroom";
import { isAssignmentOverdue } from "@/lib/classroom/overdue";
import { getMembership, hasOrgCapability, isSystemAdmin } from "@/lib/org";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getClassroomAnalytics,
  viewerRoleForClassroom,
} from "@/lib/analytics/tenant";
import { articleAccessContext } from "@/lib/article-library";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  PageShell,
  Select,
} from "@/components/ui";
import { buttonVariants } from "@/components/ui/Button";
import { StatCard } from "@/components/analytics/StatCard";
import AddStudentForm from "@/components/teacher/AddStudentForm";
import AssignArticleForm from "@/components/teacher/AssignArticleForm";
import AssignmentFeedbackForm from "@/components/teacher/AssignmentFeedbackForm";
import ClassroomSettingsCard from "@/components/teacher/ClassroomSettingsCard";
import DeleteAssignmentButton from "@/components/teacher/DeleteAssignmentButton";
import EditAssignmentForm from "@/components/teacher/EditAssignmentForm";
import ReopenAssignmentButton from "@/components/teacher/ReopenAssignmentButton";
import RemindStudentsButton from "@/components/teacher/RemindStudentsButton";
import RemoveStudentButton from "@/components/teacher/RemoveStudentButton";
import PublishAssignmentButton from "@/components/teacher/PublishAssignmentButton";

type ClassroomAnalytics = NonNullable<
  Awaited<ReturnType<typeof getClassroomAnalytics>>
>;
type ClassroomMember = Awaited<ReturnType<typeof listClassroomMembers>>[number];
type AssignmentMeta = Awaited<ReturnType<typeof listClassroomAssignmentMeta>>[number];
type AssignmentMetaMap = Map<string, AssignmentMeta>;
type StudentCandidate = Awaited<ReturnType<typeof searchClassroomStudentCandidates>>[number];
type AssignableArticle = Awaited<ReturnType<typeof searchAssignableArticleOptions>>[number];
type SearchParams = {
  assignmentId?: string;
  studentId?: string;
};

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

const completionSourceLabels: Record<AssignmentCompletionSource, string> = {
  SELF: "self-marked",
  READING: "via reading",
  QUIZ: "via quiz",
};

function completionSourceSuffix(row: {
  status: string;
  completionSource: AssignmentCompletionSource | null;
}) {
  return row.status === "COMPLETED" && row.completionSource
    ? ` · ${completionSourceLabels[row.completionSource]}`
    : "";
}

function memberLabel(member: Pick<ClassroomMember, "name" | "email" | "userId">) {
  return member.name ?? member.email ?? member.userId;
}

function assignmentSummary(assignment: ClassroomAnalytics["perAssignment"][number]) {
  const quizSummary =
    assignment.averageQuizScore == null
      ? ""
      : ` · quiz ${pct(assignment.averageQuizScore)}`;

  return (
    `${assignment.completed} completed · ${assignment.inProgress} in progress · ` +
    `${assignment.notStarted} not started · ${pct(assignment.completionRate)}${quizSummary}`
  );
}

function assignmentDisplayTitle(
  articleTitle: string,
  meta: Pick<AssignmentMeta, "title"> | undefined,
): string {
  return meta?.title ?? articleTitle;
}

function assignmentPublishBadge(meta: Pick<AssignmentMeta, "publishState" | "publishAt">) {
  if (meta.publishState === "DRAFT") {
    return <Badge variant="neutral">Draft</Badge>;
  }
  if (meta.publishState === "SCHEDULED") {
    // server-tz: RSC formats this scheduled time using the server timezone.
    const when = meta.publishAt
      ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(meta.publishAt)
      : "not set";
    return <Badge variant="warning">Scheduled · {when}</Badge>;
  }
  return <Badge variant="neutral">Published</Badge>;
}

function assignmentPointsSuffix(points: number | null | undefined): string {
  return points == null ? "" : ` · ${points} pts`;
}

function studentSummary(student: ClassroomAnalytics["perStudent"][number]) {
  const quizSummary =
    student.averageQuizScore == null
      ? ""
      : ` · quiz ${pct(student.averageQuizScore)}`;

  return `${student.completed}/${student.total} · ${pct(
    student.completionRate,
  )}${quizSummary}`;
}

function AnalyticsSummary({ analytics }: { analytics: ClassroomAnalytics }) {
  return (
    <section className="mb-[var(--space-6)] grid grid-cols-2 gap-[var(--space-3)] md:grid-cols-4">
      <StatCard label="Students" value={analytics.studentCount} />
      <StatCard label="Assignments" value={analytics.assignmentCount} />
      <StatCard label="Completion" value={pct(analytics.completionRate)} />
      <StatCard
        label="Avg. quiz"
        value={
          analytics.averageQuizScore == null
            ? "—"
            : pct(analytics.averageQuizScore)
        }
      />
    </section>
  );
}

function assignmentSynthesizedStatus(
  assignment: ClassroomAnalytics["perAssignment"][number],
): string {
  return assignment.assigned > 0 && assignment.completed >= assignment.assigned
    ? "COMPLETED"
    : "IN_PROGRESS";
}

function AssignmentsCard({
  analytics,
  assignmentMeta,
  canManage,
  assignmentTargetStudents,
}: {
  analytics: ClassroomAnalytics | null;
  assignmentMeta: AssignmentMetaMap;
  canManage: boolean;
  assignmentTargetStudents: { id: string; label: string }[];
}) {
  const now = new Date();
  const analyticsByAssignment = new Map(
    (analytics?.perAssignment ?? []).map((assignment) => [assignment.assignmentId, assignment]),
  );
  const assignments = [...assignmentMeta.values()];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignments</CardTitle>
      </CardHeader>
      <CardBody>
        {assignments.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-text-muted">
            No assignments yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-[var(--space-3)]">
            {assignments.map((meta) => {
              const assignment = analyticsByAssignment.get(meta.assignmentId);
              const displayTitle = assignmentDisplayTitle(meta.articleTitle, meta);
              const overdue = assignment
                ? isAssignmentOverdue(
                    meta.dueDate,
                    assignmentSynthesizedStatus(assignment),
                    now,
                  )
                : false;
              return (
                <li
                  key={meta.assignmentId}
                  className="flex flex-col gap-[var(--space-2)] border-b border-border pb-[var(--space-2)] last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex flex-col gap-[var(--space-1)]">
                    <span className="flex items-center gap-[var(--space-2)] font-medium text-text">
                      {displayTitle}
                      {overdue ? <Badge variant="danger">Overdue</Badge> : null}
                      {assignmentPublishBadge(meta)}
                    </span>
                    {meta?.title ? (
                      <span className="text-[length:var(--text-sm)] text-text-muted">
                        {meta.articleTitle}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex flex-col items-start gap-[var(--space-1)] sm:items-end">
                    <span className="text-[length:var(--text-sm)] text-text-muted">
                      {assignment
                        ? assignmentSummary(assignment)
                        : "Not visible to students yet"}
                      {assignmentPointsSuffix(meta.points)}
                    </span>
                    {meta && meta.targetStudentIds.length > 0 ? (
                      <Badge variant="neutral">{meta.targetStudentIds.length} students</Badge>
                    ) : (
                      <Badge variant="neutral">Whole class</Badge>
                    )}
                    {canManage ? (
                      <div className="flex items-center gap-[var(--space-2)]">
                        <EditAssignmentForm
                          assignmentId={meta.assignmentId}
                          assignmentTitle={displayTitle}
                          initialDueDate={meta.dueDate?.toISOString() ?? null}
                          initialInstructions={meta.instructions}
                          initialTitle={meta.title}
                          initialPoints={meta.points}
                          initialTargetIds={meta.targetStudentIds}
                          students={assignmentTargetStudents}
                        />
                        <DeleteAssignmentButton
                          assignmentId={meta.assignmentId}
                          assignmentTitle={displayTitle}
                        />
                        {meta.publishState !== "PUBLISHED" ? (
                          <PublishAssignmentButton
                            assignmentId={meta.assignmentId}
                            assignmentTitle={displayTitle}
                          />
                        ) : null}
                        {assignment && assignment.completed > 0 ? (
                          <ReopenAssignmentButton
                            assignmentId={meta.assignmentId}
                            assignmentTitle={displayTitle}
                          />
                        ) : null}
                        {assignment ? (
                          <RemindStudentsButton
                            assignmentId={meta.assignmentId}
                            assignmentTitle={displayTitle}
                            pendingCount={assignment.inProgress + assignment.notStarted}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function StudentProgressCard({
  analytics,
}: {
  analytics: ClassroomAnalytics | null;
}) {
  if (analytics && !analytics.redacted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Student progress</CardTitle>
        </CardHeader>
        <CardBody>
          {analytics.perStudent.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-text-muted">
              No students enrolled yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-[var(--space-2)]">
              {analytics.perStudent.map((student) => (
                <li
                  key={student.studentId}
                  className="flex items-center justify-between gap-[var(--space-3)]"
                >
                  <span className="text-text">
                    {student.name ?? student.email ?? student.studentId}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-text-muted">
                    {studentSummary(student)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <p className="text-[length:var(--text-sm)] text-text-muted">
          Individual student data is hidden in the aggregate view to protect
          learner privacy.
        </p>
      </CardBody>
    </Card>
  );
}

  function buildExportHref(
    classroomId: string,
    format: "csv" | "json",
    filters: SearchParams,
  ): string {
    const params = new URLSearchParams({ format });
    if (filters.assignmentId) params.set("assignmentId", filters.assignmentId);
    if (filters.studentId) params.set("studentId", filters.studentId);
    return `/api/classrooms/${classroomId}/analytics/export?${params.toString()}`;
  }

  function AnalyticsFilters({
    classroomId,
    analytics,
    assignmentMeta,
    students,
    filters,
  }: {
    classroomId: string;
    analytics: ClassroomAnalytics | null;
    assignmentMeta: AssignmentMetaMap;
    students: ClassroomMember[];
    filters: SearchParams;
  }) {
    const canFilterStudents = analytics ? !analytics.redacted : false;
    return (
      <Card className="mb-[var(--space-6)]">
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-[var(--space-3)]">
            <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
              <span className="text-text-muted">Assignment</span>
              <Select name="assignmentId" defaultValue={filters.assignmentId ?? ""} selectSize="md" className="w-auto">
                <option value="">All assignments</option>
                {(analytics?.perAssignment ?? []).map((assignment) => {
                  const meta = assignmentMeta.get(assignment.assignmentId);
                  return (
                    <option key={assignment.assignmentId} value={assignment.assignmentId}>
                      {assignmentDisplayTitle(assignment.articleTitle, meta)}
                    </option>
                  );
                })}
              </Select>
            </label>
            {canFilterStudents ? (
              <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
                <span className="text-text-muted">Student</span>
                <Select name="studentId" defaultValue={filters.studentId ?? ""} selectSize="md" className="w-auto">
                  <option value="">All students</option>
                  {students.map((student) => (
                    <option key={student.userId} value={student.userId}>
                      {memberLabel(student)}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <Button type="submit" variant="primary" size="md" className="w-auto">
              Apply
            </Button>
            <Link
              href={buildExportHref(classroomId, "csv", filters)}
              className={buttonVariants({ variant: "outline", size: "md" })}
              prefetch={false}
            >
              Export CSV
            </Link>
            <Link
              href={buildExportHref(classroomId, "json", filters)}
              className={buttonVariants({ variant: "outline", size: "md" })}
              prefetch={false}
            >
              Export JSON
            </Link>
          </form>
        </CardBody>
      </Card>
    );
  }

  function DrilldownCard({
    analytics,
    assignmentMeta,
  }: {
    analytics: ClassroomAnalytics | null;
    assignmentMeta: AssignmentMetaMap;
  }) {
    if (!analytics?.drilldown || analytics.redacted) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analytics drilldown</CardTitle>
        </CardHeader>
        <CardBody>
          {analytics.drilldown.rows.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-text-muted">
              No matching assignment progress.
            </p>
          ) : (
            <ul className="flex flex-col gap-[var(--space-2)]">
              {analytics.drilldown.rows.map((row) => {
                const meta = assignmentMeta.get(row.assignmentId);
                return (
                  <li
                    key={`${row.assignmentId}:${row.studentId}`}
                    className="rounded-[var(--radius-md)] border border-border p-[var(--space-3)]"
                  >
                    <div className="flex flex-col gap-[var(--space-1)] sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-medium text-text">
                        {row.name ?? row.email ?? row.studentId}
                      </span>
                      <Badge variant={row.status === "COMPLETED" ? "success" : "neutral"}>
                        {row.status.toLowerCase().replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-[length:var(--text-sm)] text-text-muted m-0 mt-[var(--space-1)]">
                      {assignmentDisplayTitle(row.articleTitle, meta)}
                      {row.quizScore == null ? "" : ` · quiz ${pct(row.quizScore)}`}
                      {completionSourceSuffix(row)}
                      {assignmentPointsSuffix(meta?.points)}
                    </p>
                    {meta?.title ? (
                      <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
                        Article: {row.articleTitle}
                      </p>
                    ) : null}
                    <div className="mt-[var(--space-2)]">
                      <AssignmentFeedbackForm
                        assignmentId={row.assignmentId}
                        studentId={row.studentId}
                        initialFeedback={row.feedback}
                        points={meta?.points}
                        initialPointsAwarded={row.pointsAwarded}
                        studentLabel={row.name ?? row.email ?? row.studentId}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    );
  }

function TeacherSidebar({
  classroomId,
  canManage,
  canManageLifecycle,
  classroomName,
  archivedAt,
  students,
  studentCandidates,
  articleOptions,
}: {
  classroomId: string;
  canManage: boolean;
  canManageLifecycle: boolean;
  classroomName: string;
  archivedAt: string | null;
  students: ClassroomMember[];
  studentCandidates: StudentCandidate[];
  articleOptions: AssignableArticle[];
}) {
  const assignmentTargetStudents = students.map((student) => ({
    id: student.userId,
    label: memberLabel(student),
  }));

  return (
    <aside className="flex flex-col gap-[var(--space-6)]">
      {canManageLifecycle ? (
        <ClassroomSettingsCard
          classroomId={classroomId}
          classroomName={classroomName}
          archivedAt={archivedAt}
        />
      ) : null}
      {canManage ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Assign a reading</CardTitle>
            </CardHeader>
            <CardBody>
              <AssignArticleForm
                classroomId={classroomId}
                initialArticles={articleOptions}
                students={assignmentTargetStudents}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Roster ({students.length})</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-[var(--space-4)]">
              <AddStudentForm
                classroomId={classroomId}
                initialCandidates={studentCandidates}
              />
              {students.length > 0 ? (
                <ul className="flex flex-col gap-[var(--space-1)]">
                  {students.map((student) => (
                    <li
                      key={student.userId}
                      className="flex items-center justify-between gap-[var(--space-3)]"
                    >
                      <span className="text-[length:var(--text-sm)] text-text-muted">
                        {memberLabel(student)}
                      </span>
                      <RemoveStudentButton
                        classroomId={classroomId}
                        studentId={student.userId}
                        studentLabel={memberLabel(student)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        </>
      ) : null}
    </aside>
  );
}

/**
 * Classroom detail + class analytics (RW-061/063). The viewer's role scopes what
 * they see: the classroom's teacher (and system admins) get per-student detail;
 * an org admin gets aggregate-only numbers (individual rows redacted). Learners
 * never reach this page — they use `/assignments`.
 */
export default async function ClassroomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const filters = await searchParams;
  const session = await requireSession(`/teacher/classrooms/${id}`);

  const classroom = await getClassroom(id);
  if (!classroom) notFound();

  const membership = await getMembership(session.user.id, classroom.orgId);
  const isOrgAdmin = hasOrgCapability(membership, CAPABILITIES.orgManage);
  const isTeacher = classroom.teacherId === session.user.id;
  const canView = isTeacher || isOrgAdmin || isSystemAdmin(session.user.role);
  if (!canView) redirect("/forbidden");

  const role = viewerRoleForClassroom({
    viewer: session.user,
    classroom,
    isOrgAdmin,
  });

  const [members, filterAnalytics, analytics, assignmentMetaRows] = await Promise.all([
    listClassroomMembers(id),
    getClassroomAnalytics(id, role),
    getClassroomAnalytics(id, role, {
      assignmentId: filters.assignmentId || undefined,
      studentId: filters.studentId || undefined,
    }),
    listClassroomAssignmentMeta(id),
  ]);
  const assignmentMeta: AssignmentMetaMap = new Map(
    assignmentMetaRows.map((row) => [row.assignmentId, row]),
  );

  const isArchived = classroom.archivedAt != null;
  const canManage = isTeacher || isOrgAdmin || isSystemAdmin(session.user.role);
  const canManageActiveClassroom = canManage && !isArchived;
  const students = members.filter((m) => m.role === "Student");
  const assignmentTargetStudents = students.map((student) => ({
    id: student.userId,
    label: memberLabel(student),
  }));
  const [studentCandidates, articleOptions] = canManageActiveClassroom
    ? await Promise.all([
        searchClassroomStudentCandidates(id, classroom.orgId),
        searchAssignableArticleOptions(articleAccessContext(session.user, classroom.orgId)),
      ])
    : [[], []];

  return (
    <PageShell>
      <PageHeader
        title={classroom.name}
        description="Class roster, assignments, and progress."
        actions={
         <div className="flex flex-wrap items-center gap-[var(--space-2)]">
           {isArchived ? <Badge variant="neutral">Archived</Badge> : null}
           <Badge variant={role === "orgAdmin" ? "warning" : "primary"}>
             {role === "orgAdmin" ? "Aggregate view" : "Teacher view"}
           </Badge>
         </div>
        }
      />

      {analytics ? <AnalyticsSummary analytics={analytics} /> : null}
      <AnalyticsFilters
        classroomId={id}
        analytics={filterAnalytics}
        assignmentMeta={assignmentMeta}
        students={students}
        filters={filters}
      />

      <div className="grid gap-[var(--space-6)] md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[var(--space-6)]">
          <AssignmentsCard
            analytics={analytics}
            assignmentMeta={assignmentMeta}
            canManage={canManageActiveClassroom}
            assignmentTargetStudents={assignmentTargetStudents}
          />
          <DrilldownCard analytics={analytics} assignmentMeta={assignmentMeta} />
          <StudentProgressCard analytics={analytics} />
        </div>

        <TeacherSidebar
          classroomId={id}
          canManage={canManageActiveClassroom}
          canManageLifecycle={canManage}
          classroomName={classroom.name}
          archivedAt={classroom.archivedAt?.toISOString() ?? null}
          students={students}
          studentCandidates={studentCandidates}
          articleOptions={articleOptions}
        />
      </div>
    </PageShell>
  );
}
