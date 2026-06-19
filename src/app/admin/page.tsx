import { requireAdmin } from "@/lib/session";
import { getAdminOverview } from "@/lib/admin";
import { Card, CardMeta } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-[var(--space-4)]">
      <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
        {value}
      </div>
      <CardMeta>{label}</CardMeta>
    </Card>
  );
}

function statusBadgeVariant(
  status: string,
): "success" | "neutral" | "warning" | "danger" {
  if (status === "published") return "success";
  if (status === "processing") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

export default async function AdminPage() {
  const session = await requireAdmin("/admin");
  const overview = await getAdminOverview();

  return (
    <section className="stack mt-[var(--space-6)]">
      <p className="muted" style={{ margin: 0 }}>
        Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
        ({session.user.role})
      </p>

      <h2>Overview</h2>
      <div className="admin-stat-grid">
        <StatCard label="Total members" value={overview.users} />
        <StatCard label="Admins" value={overview.admins} />
        <StatCard label="Articles" value={overview.articles} />
        <StatCard label="Published" value={overview.published} />
        <StatCard label="Tags" value={overview.tags} />
        <StatCard label="Reads tracked" value={overview.readingProgress} />
      </div>

      <h2>Processing status</h2>
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
