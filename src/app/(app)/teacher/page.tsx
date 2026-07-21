import Link from "next/link";
import { GraduationCap, Users } from "lucide-react";
import { requireSession } from "@/lib/session";
import {
  listOrgMembers,
  listUserOrganizations,
  hasOrgCapability,
} from "@/lib/org";
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
import ArchivedClassroomsSection from "@/components/teacher/ArchivedClassroomsSection";
import OrgMembersCard from "@/components/teacher/OrgMembersCard";

type OrganizationMembership = Awaited<
  ReturnType<typeof listUserOrganizations>
>[number];
type OrganizationMember = Awaited<ReturnType<typeof listOrgMembers>>[number];
type TeacherClassroom = Awaited<
  ReturnType<typeof listClassroomsForTeacher>
>[number];
type TeachableOrg = { id: string; name: string };
type ManageableOrganization = {
  id: string;
  name: string;
  members: OrganizationMember[];
};

function getTeachableOrgs(
  memberships: OrganizationMembership[],
): TeachableOrg[] {
  return memberships
    .filter((m) => hasOrgCapability(m, CAPABILITIES.classroomManage))
    .map((m) => ({ id: m.org.id, name: m.org.name }));
}

function getOrgNameById(memberships: OrganizationMembership[]) {
  return new Map(memberships.map((m) => [m.org.id, m.org.name]));
}

async function getManageableOrganizations(
  memberships: OrganizationMembership[],
): Promise<ManageableOrganization[]> {
  const manageable = memberships.filter((membership) =>
    hasOrgCapability(membership, CAPABILITIES.orgMembersManage),
  );

  return Promise.all(
    manageable.map(async (membership) => ({
      id: membership.org.id,
      name: membership.org.name,
      members: await listOrgMembers(membership.org.id),
    })),
  );
}

function ClassroomList({
  classrooms,
  orgNameById,
}: {
  classrooms: TeacherClassroom[];
  orgNameById: Map<string, string>;
}) {
  return (
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
  );
}

function TeacherSidebar({ teachableOrgs }: { teachableOrgs: TeachableOrg[] }) {
  if (teachableOrgs.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New classroom</CardTitle>
        </CardHeader>
        <CardBody>
          <CreateClassroomForm orgs={teachableOrgs} />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start an organization</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-3)]">
        <p className="text-[length:var(--text-sm)] text-text-muted">
          Classrooms live inside an organization. Create one to become its admin
          and start teaching.
        </p>
        <CreateOrgForm />
      </CardBody>
    </Card>
  );
}

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

  const teachableOrgs = getTeachableOrgs(memberships);
  const orgNameById = getOrgNameById(memberships);
  const manageableOrganizations = await getManageableOrganizations(memberships);

  return (
    <PageShell>
      <PageHeader
        title="Teaching"
        description="Create classrooms, assign readings, and track your students' progress."
      />

      <div className="grid gap-[var(--space-6)] md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[var(--space-6)]">
          <Section title="Your classrooms">
            {classrooms.length === 0 ? (
              <EmptyState
                icon={GraduationCap}
                title="No classrooms yet"
                description="Create a classroom to start assigning readings to your students."
              />
            ) : (
              <ClassroomList classrooms={classrooms} orgNameById={orgNameById} />
            )}
          </Section>

          <Section
            title="Archived classrooms"
            description="Restore classrooms that were hidden from your active teaching list."
          >
            <ArchivedClassroomsSection />
          </Section>

          {manageableOrganizations.length > 0 ? (
            <Section
              title="Organization members"
              description="Manage member roles and removals for organizations you administer."
            >
              <div className="flex flex-col gap-[var(--space-3)]">
                {manageableOrganizations.map((org) => (
                  <OrgMembersCard
                    key={org.id}
                    orgId={org.id}
                    orgName={org.name}
                    viewerUserId={userId}
                    initialMembers={org.members}
                  />
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-[var(--space-4)]">
          <TeacherSidebar teachableOrgs={teachableOrgs} />
        </aside>
      </div>
    </PageShell>
  );
}
