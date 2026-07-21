import { notFound, redirect } from "next/navigation";
import Link from "next/link";
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
import ClassroomSettingsCard from "@/components/teacher/ClassroomSettingsCard";
import DeleteAssignmentButton from "@/components/teacher/DeleteAssignmentButton";
import EditAssignmentForm from "@/components/teacher/EditAssignmentForm";
import RemoveStudentButton from "@/components/teacher/RemoveStudentButton";

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
}: {
  analytics: ClassroomAnalytics | null;
  assignmentMeta: AssignmentMetaMap;
  canManage: boolean;
}) {
  const now = new Date();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignments</CardTitle>
      </CardHeader>
      <CardBody>
        {!analytics || analytics.perAssignment.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-text-muted">
            No assignments yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-[var(--space-3)]">
            {analytics.perAssignment.map((assignment) => {
              const meta = assignmentMeta.get(assignment.assignmentId);
              const overdue = isAssignmentOverdue(
                meta?.dueDate ?? null,
                assignmentSynthesizedStatus(assignment),
                now,
              );
              return (
                <li
                  key={assignment.assignmentId}
                  className="flex flex-col gap-[var(--space-2)] border-b border-border pb-[var(--space-2)] last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex items-center gap-[var(--space-2)] font-medium text-text">
                    {assignment.articleTitle}
                    {overdue ? <Badge variant="danger">Overdue</Badge> : null}
                  </span>
                  <div className="flex flex-col items-start gap-[var(--space-1)] sm:items-end">
                    <span className="text-[length:var(--text-sm)] text-text-muted">
                      {assignmentSummary(assignment)}
                    </span>
                    {canManage ? (
                      <div className="flex items-center gap-[var(--space-2)]">
                        <EditAssignmentForm
                          assignmentId={assignment.assignmentId}
                          assignmentTitle={assignment.articleTitle}
                          initialDueDate={meta?.dueDate?.toISOString() ?? null}
                          initialInstructions={meta?.instructions ?? null}
                        />
                        <DeleteAssignmentButton
                          assignmentId={assignment.assignmentId}
                          assignmentTitle={assignment.articleTitle}
                        />
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
    students,
    filters,
  }: {
    classroomId: string;
    analytics: ClassroomAnalytics | null;
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
                {(analytics?.perAssignment ?? []).map((assignment) => (
                  <option key={assignment.assignmentId} value={assignment.assignmentId}>
                    {assignment.articleTitle}
                  </option>
                ))}
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

  function DrilldownCard({ analytics }: { analytics: ClassroomAnalytics | null }) {
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
              {analytics.drilldown.rows.map((row) => (
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
                    {row.articleTitle}
                    {row.quizScore == null ? "" : ` · quiz ${pct(row.quizScore)}`}
                  </p>
                </li>
              ))}
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
        students={students}
        filters={filters}
      />

      <div className="grid gap-[var(--space-6)] md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[var(--space-6)]">
          <AssignmentsCard
            analytics={analytics}
            assignmentMeta={assignmentMeta}
            canManage={canManageActiveClassroom}
          />
          <DrilldownCard analytics={analytics} />
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
