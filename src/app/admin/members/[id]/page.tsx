import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Avatar from "@/components/ui/Avatar";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getMemberDetail } from "@/lib/account-lifecycle";
import AdminMemberSupportActions from "@/components/AdminMemberSupportActions";
import { StatCard } from "@/components/analytics/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { AdminTableWrap } from "@/components/admin";
import { formatShortDate } from "@/lib/display-format";

const SECTION_HEADING_CLASS =
  "font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text";

type MemberDetail = NonNullable<Awaited<ReturnType<typeof getMemberDetail>>>;
type MemberProfile = NonNullable<MemberDetail["profile"]>;

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className={SECTION_HEADING_CLASS}>{children}</h2>;
}

function ProfileItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="muted text-[length:var(--text-sm)]">{label}</dt>
      <dd className="m-0 font-semibold">{children}</dd>
    </div>
  );
}

function formatTopics(topics: MemberProfile["topics"]): string {
  return topics.length > 0 ? topics.join(", ") : "—";
}

function formatActorLabel(entry: MemberDetail["auditTrail"][number]): string {
  return `${entry.actorRole ?? "—"}${entry.actorId ? ` (${entry.actorId.slice(0, 8)}…)` : ""}`;
}

export default async function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireCapability(
    CAPABILITIES.supportAssist,
    `/admin/members/${id}`,
  );

  const detail = await getMemberDetail(id);
  if (!detail) notFound();

  const isSelf = detail.user.id === session.user.id;

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h1 className="m-0 text-[length:var(--text-2xl)] font-[family-name:var(--font-display)] font-bold text-text">
          Member support
        </h1>
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href="/admin/members"
        >
          ← Back to members
        </Link>
      </div>

      <Card>
        <div className="admin-member-cell">
          <Avatar
            src={detail.user.image}
            name={detail.user.name ?? detail.user.email}
            size={48}
            className="admin-member-avatar"
          />
          <div className="admin-member-name">
            <span className="text-[length:var(--text-lg)] font-semibold">
              {detail.user.name ?? "—"}
              <Badge
                variant={detail.user.role === "Admin" ? "primary" : "neutral"}
                className="ml-[var(--space-2)]"
              >
                {detail.user.role}
              </Badge>
              {isSelf && (
                <Badge variant="neutral" className="ml-[var(--space-1)]">
                  You
                </Badge>
              )}
            </span>
            <span className="muted">{detail.user.email ?? "no email"}</span>
            <span className="muted text-[length:var(--text-sm)]">
              Joined {formatShortDate(detail.user.createdAt)} ·{" "}
              {detail.user.emailVerified ? "email verified" : "email unverified"} ·{" "}
              {detail.sessions.active} active session(s)
            </span>
          </div>
        </div>
      </Card>

      <SectionHeading>Support actions</SectionHeading>
      <Card>
        <AdminMemberSupportActions memberId={detail.user.id} isSelf={isSelf} />
      </Card>

      <SectionHeading>Activity summary</SectionHeading>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-4)]">
        <StatCard label="Articles started" value={detail.progress.started} />
        <StatCard label="Articles completed" value={detail.progress.completed} />
        <StatCard label="Saved words" value={detail.savedWords} />
        <StatCard label="Quiz attempts" value={detail.quizAttempts} />
      </div>

      <SectionHeading>Profile</SectionHeading>
      <Card>
        {detail.profile ? (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-3)] m-0">
            <ProfileItem label="Level">{detail.profile.englishLevel}</ProfileItem>
            <ProfileItem label="Daily goal">{detail.profile.dailyGoal}</ProfileItem>
            <ProfileItem label="Onboarded">
              {detail.profile.completedAt
                ? formatShortDate(detail.profile.completedAt)
                : "No"}
            </ProfileItem>
            <ProfileItem label="Topics">{formatTopics(detail.profile.topics)}</ProfileItem>
          </dl>
        ) : (
          <p className="muted m-0">No profile (onboarding not completed).</p>
        )}
      </Card>

      <SectionHeading>Imports ({detail.importCount})</SectionHeading>
      <Card>
        {detail.imports.length === 0 ? (
          <p className="muted m-0">No imported articles.</p>
        ) : (
          <AdminTableWrap ariaLabel="Imports (scrollable)">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Imported</th>
              </tr>
            </thead>
            <tbody>
              {detail.imports.map((imp) => (
                <tr key={imp.id}>
                  <td>
                    <Link href={`/admin/articles/${imp.id}`}>{imp.title}</Link>
                  </td>
                  <td>
                    <Badge variant="neutral">{imp.status}</Badge>
                  </td>
                  <td className="muted">{formatShortDate(imp.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTableWrap>
        )}
      </Card>

      <SectionHeading>Recent activity</SectionHeading>
      <Card>
        {detail.recentActivity.length === 0 ? (
          <p className="muted m-0">No recent reading activity.</p>
        ) : (
          <ul className="m-0">
            {detail.recentActivity.map((a) => (
              <li key={a.date}>
                {a.date}: {a.articlesRead} article(s) read
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionHeading>Admin action history</SectionHeading>
      <Card>
        {detail.auditTrail.length === 0 ? (
          <p className="muted m-0">No admin actions recorded for this member.</p>
        ) : (
          <AdminTableWrap ariaLabel="Audit trail (scrollable)">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {detail.auditTrail.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted">{formatShortDate(entry.createdAt)}</td>
                  <td>{entry.action}</td>
                  <td className="muted">{formatActorLabel(entry)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTableWrap>
        )}
      </Card>
    </section>
  );
}
