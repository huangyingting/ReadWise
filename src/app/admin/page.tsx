import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getAdminOverview, statusBadgeVariant } from "@/lib/admin";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/analytics/StatCard";

export default async function AdminPage() {
  const session = await requireCapability(CAPABILITIES.adminAccess, "/admin");
  const overview = await getAdminOverview();

  return (
    <section className="stack">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Dashboard
      </h1>
      <p className="muted" style={{ margin: 0 }}>
        Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
        ({session.user.role})
      </p>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Overview
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
        <StatCard label="Total members" value={overview.users} />
        <StatCard label="Admins" value={overview.admins} />
        <StatCard label="Articles" value={overview.articles} />
        <StatCard label="Published" value={overview.published} />
        <StatCard label="Tags" value={overview.tags} />
        <StatCard label="Reads tracked" value={overview.readingProgress} />
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Processing status
      </h2>
      {overview.statusCounts.length === 0 ? (
        <p className="muted">No articles yet.</p>
      ) : (
        <Card>
          <div className="stack">
            {overview.statusCounts.map((s) => (
              <div
                key={s.status}
                className="flex justify-between items-center"
              >
                <Badge variant={statusBadgeVariant(s.status)}>
                  {s.status}
                </Badge>
                <strong>{s.count}</strong>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}
