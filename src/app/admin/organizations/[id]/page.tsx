import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getOrganizationDetail } from "@/lib/admin/organizations";
import AdminOrgMemberActions from "@/components/admin/organizations/AdminOrgMemberActions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { AdminPageHeader, AdminTableWrap } from "@/components/admin";
import { formatShortDate } from "@/lib/display-format";

const SECTION_HEADING_CLASS =
  "font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text";

type OrganizationDetail = NonNullable<
  Awaited<ReturnType<typeof getOrganizationDetail>>
>;
type MemberRow = OrganizationDetail["members"][number];
type ClassroomRow = OrganizationDetail["classrooms"][number];

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className={SECTION_HEADING_CLASS}>{children}</h2>;
}

function MemberRoleBadge({ role }: { role: MemberRow["role"] }) {
  const variant = role === "OrgAdmin" ? "primary" : role === "Teacher" ? "warning" : "neutral";
  return <Badge variant={variant}>{role}</Badge>;
}

function MembersSection({
  orgId,
  members,
}: {
  orgId: string;
  members: MemberRow[];
}) {
  return (
    <section className="stack">
      <SectionHeading>Members ({members.length})</SectionHeading>
      {members.length === 0 ? (
        <p className="muted">No members yet.</p>
      ) : (
        <AdminTableWrap ariaLabel="Organization members table (scrollable)">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col">Manage</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>
                  <span className="admin-member-name">
                    <span>{member.name ?? "—"}</span>
                    <span className="muted">{member.email ?? "no email"}</span>
                  </span>
                </td>
                <td>
                  <MemberRoleBadge role={member.role} />
                </td>
                <td className="muted">{formatShortDate(member.joinedAt)}</td>
                <td>
                  <AdminOrgMemberActions
                    orgId={orgId}
                    memberId={member.userId}
                    role={member.role}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      )}
    </section>
  );
}

function ClassroomsSection({ classrooms }: { classrooms: ClassroomRow[] }) {
  return (
    <section className="stack">
      <SectionHeading>Classrooms ({classrooms.length})</SectionHeading>
      {classrooms.length === 0 ? (
        <p className="muted">No classrooms yet.</p>
      ) : (
        <AdminTableWrap ariaLabel="Organization classrooms table (scrollable)">
          <thead>
            <tr>
              <th scope="col">Classroom</th>
              <th scope="col">Teacher</th>
              <th scope="col">Assignments</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {classrooms.map((classroom) => (
              <tr key={classroom.id}>
                <td>{classroom.name}</td>
                <td>
                  <span className="admin-member-name">
                    <span>{classroom.teacherName ?? "—"}</span>
                    <span className="muted">
                      {classroom.teacherEmail ?? "no email"}
                    </span>
                  </span>
                </td>
                <td className="muted">{classroom.assignmentCount}</td>
                <td className="muted">{formatShortDate(classroom.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      )}
    </section>
  );
}

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireCapability(
    CAPABILITIES.organizationsManage,
    `/admin/organizations/${id}`,
  );

  const detail = await getOrganizationDetail(id);
  if (!detail) notFound();

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href="/admin/organizations"
        >
          ← Organizations
        </Link>
      </div>

      <AdminPageHeader>{detail.name}</AdminPageHeader>

      <Card className="stack">
        <div className="flex flex-wrap gap-[var(--space-4)]">
          <div>
            <dt className="muted text-[length:var(--text-sm)]">Slug</dt>
            <dd className="m-0 font-semibold">{detail.slug}</dd>
          </div>
          <div>
            <dt className="muted text-[length:var(--text-sm)]">Members</dt>
            <dd className="m-0 font-semibold">{detail.memberCount}</dd>
          </div>
          <div>
            <dt className="muted text-[length:var(--text-sm)]">Classrooms</dt>
            <dd className="m-0 font-semibold">{detail.classroomCount}</dd>
          </div>
          <div>
            <dt className="muted text-[length:var(--text-sm)]">Created</dt>
            <dd className="m-0 font-semibold">
              {formatShortDate(detail.createdAt)}
            </dd>
          </div>
        </div>
      </Card>

      <MembersSection orgId={detail.id} members={detail.members} />
      <ClassroomsSection classrooms={detail.classrooms} />
    </section>
  );
}
