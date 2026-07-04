import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import {
  getClassroom,
  listClassroomMembers,
  searchAssignableArticleOptions,
  searchClassroomStudentCandidates,
} from "@/lib/classroom";
import { getMembership, hasOrgCapability, isSystemAdmin } from "@/lib/org";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getClassroomAnalytics,
  viewerRoleForClassroom,
} from "@/lib/analytics/tenant";
import { articleAccessContext } from "@/lib/article-library";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  PageShell,
} from "@/components/ui";
import { StatCard } from "@/components/analytics/StatCard";
import AddStudentForm from "@/components/teacher/AddStudentForm";
import AssignArticleForm from "@/components/teacher/AssignArticleForm";

type ClassroomAnalytics = NonNullable<
  Awaited<ReturnType<typeof getClassroomAnalytics>>
>;
type ClassroomMember = Awaited<ReturnType<typeof listClassroomMembers>>[number];
type StudentCandidate = Awaited<ReturnType<typeof searchClassroomStudentCandidates>>[number];
type AssignableArticle = Awaited<ReturnType<typeof searchAssignableArticleOptions>>[number];

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

  return `${assignment.completed}/${assignment.assigned} done · ${pct(
    assignment.completionRate,
  )}${quizSummary}`;
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

function AssignmentsCard({
  analytics,
}: {
  analytics: ClassroomAnalytics | null;
}) {
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
            {analytics.perAssignment.map((assignment) => (
              <li
                key={assignment.assignmentId}
                className="flex items-center justify-between gap-[var(--space-3)] border-b border-border pb-[var(--space-2)] last:border-0"
              >
                <span className="font-medium text-text">
                  {assignment.articleTitle}
                </span>
                <span className="text-[length:var(--text-sm)] text-text-muted">
                  {assignmentSummary(assignment)}
                </span>
              </li>
            ))}
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

function TeacherSidebar({
  classroomId,
  canManage,
  students,
  studentCandidates,
  articleOptions,
}: {
  classroomId: string;
  canManage: boolean;
  students: ClassroomMember[];
  studentCandidates: StudentCandidate[];
  articleOptions: AssignableArticle[];
}) {
  return (
    <aside className="flex flex-col gap-[var(--space-6)]">
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
                      className="text-[length:var(--text-sm)] text-text-muted"
                    >
                      {memberLabel(student)}
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const [members, analytics] = await Promise.all([
    listClassroomMembers(id),
    getClassroomAnalytics(id, role),
  ]);

  const canManage = isTeacher || isOrgAdmin || isSystemAdmin(session.user.role);
  const students = members.filter((m) => m.role === "Student");
  const [studentCandidates, articleOptions] = canManage
    ? await Promise.all([
        searchClassroomStudentCandidates(id),
        searchAssignableArticleOptions(articleAccessContext(session.user)),
      ])
    : [[], []];

  return (
    <PageShell>
      <PageHeader
        title={classroom.name}
        description="Class roster, assignments, and progress."
        actions={
          <Badge variant={role === "orgAdmin" ? "warning" : "primary"}>
            {role === "orgAdmin" ? "Aggregate view" : "Teacher view"}
          </Badge>
        }
      />

      {analytics ? <AnalyticsSummary analytics={analytics} /> : null}

      <div className="grid gap-[var(--space-6)] md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[var(--space-6)]">
          <AssignmentsCard analytics={analytics} />
          <StudentProgressCard analytics={analytics} />
        </div>

        <TeacherSidebar
          classroomId={id}
          canManage={canManage}
          students={students}
          studentCandidates={studentCandidates}
          articleOptions={articleOptions}
        />
      </div>
    </PageShell>
  );
}
