import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getAdminOverview, statusBadgeVariant } from "@/lib/admin/overview";
import { Badge, Card, CardTitle, Stack } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin";
import { StatCard } from "@/components/analytics/StatCard";

export default async function AdminPage() {
  const session = await requireCapability(CAPABILITIES.adminAccess, "/admin");
  const overview = await getAdminOverview();

  return (
    <section className="stack">
      <AdminPageHeader>Dashboard</AdminPageHeader>
      <p className="m-0 text-text-muted">
        Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
        ({session.user.role})
      </p>

      <CardTitle level="h2">Overview</CardTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
        <StatCard label="Total members" value={overview.users} />
        <StatCard label="Admins" value={overview.admins} />
        <StatCard label="Articles" value={overview.articles} />
        <StatCard label="Published" value={overview.published} />
        <StatCard label="Tags" value={overview.tags} />
        <StatCard label="Reads tracked" value={overview.readingProgress} />
      </div>

      <CardTitle level="h2">Processing status</CardTitle>
      {overview.statusCounts.length === 0 ? (
        <p className="text-text-muted">No articles yet.</p>
      ) : (
        <Card>
          <Stack>
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
          </Stack>
        </Card>
      )}
    </section>
  );
}
