import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/components/ui/Avatar";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getMemberDetail } from "@/lib/account-lifecycle";
import AdminMemberSupportActions from "@/components/AdminMemberSupportActions";
import { StatCard } from "@/components/analytics/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/display-format";

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

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Support actions
      </h2>
      <Card>
        <AdminMemberSupportActions memberId={detail.user.id} isSelf={isSelf} />
      </Card>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Activity summary
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-4)]">
        <StatCard label="Articles started" value={detail.progress.started} />
        <StatCard label="Articles completed" value={detail.progress.completed} />
        <StatCard label="Saved words" value={detail.savedWords} />
        <StatCard label="Quiz attempts" value={detail.quizAttempts} />
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Profile
      </h2>
      <Card>
        {detail.profile ? (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-3)] m-0">
            <div>
              <dt className="muted text-[length:var(--text-sm)]">Level</dt>
              <dd className="m-0 font-semibold">{detail.profile.englishLevel}</dd>
            </div>
            <div>
              <dt className="muted text-[length:var(--text-sm)]">Daily goal</dt>
              <dd className="m-0 font-semibold">{detail.profile.dailyGoal}</dd>
            </div>
            <div>
              <dt className="muted text-[length:var(--text-sm)]">Onboarded</dt>
              <dd className="m-0 font-semibold">
                {detail.profile.completedAt
                  ? formatShortDate(detail.profile.completedAt)
                  : "No"}
              </dd>
            </div>
            <div>
              <dt className="muted text-[length:var(--text-sm)]">Topics</dt>
              <dd className="m-0 font-semibold">
                {detail.profile.topics.length > 0
                  ? detail.profile.topics.join(", ")
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted m-0">No profile (onboarding not completed).</p>
        )}
      </Card>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Imports ({detail.importCount})
      </h2>
      <Card>
        {detail.imports.length === 0 ? (
          <p className="muted m-0">No imported articles.</p>
        ) : (
          <div className="admin-table-wrap" tabIndex={0} aria-label="Imports (scrollable)">
            <table className="admin-table">
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
            </table>
          </div>
        )}
      </Card>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Recent activity
      </h2>
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

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Admin action history
      </h2>
      <Card>
        {detail.auditTrail.length === 0 ? (
          <p className="muted m-0">No admin actions recorded for this member.</p>
        ) : (
          <div className="admin-table-wrap" tabIndex={0} aria-label="Audit trail (scrollable)">
            <table className="admin-table">
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
                    <td className="muted">
                      {entry.actorRole ?? "—"}
                      {entry.actorId ? ` (${entry.actorId.slice(0, 8)}…)` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
