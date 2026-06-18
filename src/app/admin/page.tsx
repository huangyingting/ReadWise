import { requireAdmin } from "@/lib/session";
import { getAdminOverview } from "@/lib/admin";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card admin-stat">
      <div className="admin-stat-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

export default async function AdminPage() {
  const session = await requireAdmin("/admin");
  const overview = await getAdminOverview();

  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <p className="muted" style={{ margin: 0 }}>
        Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
        ({session.user.role})
      </p>

      <h2 style={{ marginBottom: 0 }}>Overview</h2>
      <div className="admin-stat-grid">
        <StatCard label="Total members" value={overview.users} />
        <StatCard label="Admins" value={overview.admins} />
        <StatCard label="Articles" value={overview.articles} />
        <StatCard label="Published" value={overview.published} />
        <StatCard label="Tags" value={overview.tags} />
        <StatCard label="Reads tracked" value={overview.readingProgress} />
      </div>

      <h2 style={{ marginBottom: 0 }}>Processing status</h2>
      {overview.statusCounts.length === 0 ? (
        <p className="muted">No articles yet.</p>
      ) : (
        <div className="card stack">
          {overview.statusCounts.map((s) => (
            <div
              key={s.status}
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span style={{ textTransform: "capitalize" }}>{s.status}</span>
              <strong>{s.count}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
