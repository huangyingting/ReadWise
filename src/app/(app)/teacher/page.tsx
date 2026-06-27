import Link from "next/link";
import { GraduationCap, Users } from "lucide-react";
import { requireSession } from "@/lib/session";
import { listUserOrganizations, hasOrgCapability } from "@/lib/org";
import { listClassroomsForTeacher } from "@/lib/classroom";
import { CAPABILITIES } from "@/lib/rbac";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  PageShell,
  Section,
} from "@/components/ui";
import CreateOrgForm from "@/components/teacher/CreateOrgForm";
import CreateClassroomForm from "@/components/teacher/CreateClassroomForm";

/**
 * Teacher workspace (RW-061). Lists the classrooms the signed-in user teaches
 * and lets them create new ones in any org where they hold `classroom.manage`.
 * Additive: a user with no org sees a prompt to create one (becoming OrgAdmin),
 * which keeps the global single-user experience untouched.
 */
export default async function TeacherPage() {
  const session = await requireSession("/teacher");
  const userId = session.user.id;

  const [memberships, classrooms] = await Promise.all([
    listUserOrganizations(userId),
    listClassroomsForTeacher(userId),
  ]);

  const teachableOrgs = memberships
    .filter((m) => hasOrgCapability(m, CAPABILITIES.classroomManage))
    .map((m) => ({ id: m.org.id, name: m.org.name }));

  const orgNameById = new Map(memberships.map((m) => [m.org.id, m.org.name]));

  return (
    <PageShell>
      <PageHeader
        title="Teaching"
        description="Create classrooms, assign readings, and track your students' progress."
      />

      <div className="grid gap-[var(--space-6)] md:grid-cols-[2fr_1fr]">
        <Section title="Your classrooms">
          {classrooms.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No classrooms yet"
              description="Create a classroom to start assigning readings to your students."
            />
          ) : (
            <ul className="flex flex-col gap-[var(--space-3)]">
              {classrooms.map((c) => (
                <li key={c.id}>
                  <Link href={`/teacher/classrooms/${c.id}`} className="block">
                    <Card className="transition-shadow hover:shadow-[var(--shadow-md)]">
                      <CardBody className="flex items-center justify-between gap-[var(--space-3)]">
                        <div>
                          <p className="font-medium text-text">{c.name}</p>
                          <p className="text-[length:var(--text-sm)] text-text-muted">
                            {orgNameById.get(c.orgId) ?? "Organization"}
                          </p>
                        </div>
                        <Badge variant="neutral">
                          <Users aria-hidden className="size-3.5" /> Class
                        </Badge>
                      </CardBody>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <aside className="flex flex-col gap-[var(--space-4)]">
          {teachableOrgs.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>New classroom</CardTitle>
              </CardHeader>
              <CardBody>
                <CreateClassroomForm orgs={teachableOrgs} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Start an organization</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-[var(--space-3)]">
                <p className="text-[length:var(--text-sm)] text-text-muted">
                  Classrooms live inside an organization. Create one to become its
                  admin and start teaching.
                </p>
                <CreateOrgForm />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
