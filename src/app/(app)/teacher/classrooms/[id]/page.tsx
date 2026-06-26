import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getClassroom, listClassroomMembers } from "@/lib/classroom";
import { getMembership, hasOrgCapability, isSystemAdmin } from "@/lib/org";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getClassroomAnalytics,
  viewerRoleForClassroom,
} from "@/lib/analytics/tenant";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/analytics/StatCard";
import AddStudentForm from "@/components/teacher/AddStudentForm";
import AssignArticleForm from "@/components/teacher/AssignArticleForm";

function pct(value: number): string {
  return `${Math.round(value)}%`;
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

      {analytics ? (
        <section className="mb-[var(--space-6)] grid grid-cols-2 gap-[var(--space-3)] md:grid-cols-4">
          <StatCard label="Students" value={analytics.studentCount} />
          <StatCard label="Assignments" value={analytics.assignmentCount} />
          <StatCard label="Completion" value={pct(analytics.completionRate)} />
          <StatCard
            label="Avg. quiz"
            value={analytics.averageQuizScore == null ? "—" : pct(analytics.averageQuizScore)}
          />
        </section>
      ) : null}

      <div className="grid gap-[var(--space-6)] md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[var(--space-6)]">
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
                  {analytics.perAssignment.map((a) => (
                    <li
                      key={a.assignmentId}
                      className="flex items-center justify-between gap-[var(--space-3)] border-b border-border pb-[var(--space-2)] last:border-0"
                    >
                      <span className="font-medium text-text">{a.articleTitle}</span>
                      <span className="text-[length:var(--text-sm)] text-text-muted">
                        {a.completed}/{a.assigned} done · {pct(a.completionRate)}
                        {a.averageQuizScore == null ? "" : ` · quiz ${pct(a.averageQuizScore)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {analytics && !analytics.redacted ? (
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
                    {analytics.perStudent.map((s) => (
                      <li
                        key={s.studentId}
                        className="flex items-center justify-between gap-[var(--space-3)]"
                      >
                        <span className="text-text">{s.name ?? s.email ?? s.studentId}</span>
                        <span className="text-[length:var(--text-sm)] text-text-muted">
                          {s.completed}/{s.total} · {pct(s.completionRate)}
                          {s.averageQuizScore == null ? "" : ` · quiz ${pct(s.averageQuizScore)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <p className="text-[length:var(--text-sm)] text-text-muted">
                  Individual student data is hidden in the aggregate view to protect
                  learner privacy.
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="flex flex-col gap-[var(--space-6)]">
          {canManage ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Assign a reading</CardTitle>
                </CardHeader>
                <CardBody>
                  <AssignArticleForm classroomId={id} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Roster ({students.length})</CardTitle>
                </CardHeader>
                <CardBody className="flex flex-col gap-[var(--space-4)]">
                  <AddStudentForm classroomId={id} />
                  {students.length > 0 ? (
                    <ul className="flex flex-col gap-[var(--space-1)]">
                      {students.map((s) => (
                        <li
                          key={s.userId}
                          className="text-[length:var(--text-sm)] text-text-muted"
                        >
                          {s.name ?? s.email ?? s.userId}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardBody>
              </Card>
            </>
          ) : null}
        </aside>
      </div>
    </PageShell>
  );
}
