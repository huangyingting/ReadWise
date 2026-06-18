import { requireAdmin } from "@/lib/session";
import { getAdminAnalytics, type BucketCount } from "@/lib/admin-analytics";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card admin-stat">
      <div className="admin-stat-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function BarChart({ buckets }: { buckets: BucketCount[] }) {
  if (buckets.length === 0) {
    return <p className="muted">No data yet.</p>;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="card stack">
      {buckets.map((b) => (
        <div key={b.key} className="admin-bar-row">
          <span className="admin-bar-label">{b.label}</span>
          <span className="admin-bar-track">
            <span
              className="admin-bar-fill"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </span>
          <strong className="admin-bar-value">{b.count}</strong>
        </div>
      ))}
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  await requireAdmin("/admin/analytics");
  const analytics = await getAdminAnalytics();
  const { memberActivity } = analytics;

  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginBottom: 0 }}>Member activity</h2>
      <div className="admin-stat-grid">
        <StatCard label="Total members" value={memberActivity.totalMembers} />
        <StatCard label="Active readers" value={memberActivity.activeReaders} />
        <StatCard label="Reads tracked" value={memberActivity.readsTracked} />
        <StatCard
          label="Completed reads"
          value={memberActivity.completedReads}
        />
        <StatCard label="Saved words" value={memberActivity.savedWords} />
      </div>

      <h2 style={{ marginBottom: 0 }}>Articles by category</h2>
      <BarChart buckets={analytics.articlesByCategory} />

      <h2 style={{ marginBottom: 0 }}>Articles by level</h2>
      <BarChart buckets={analytics.articlesByLevel} />

      <h2 style={{ marginBottom: 0 }}>Top tags</h2>
      <BarChart buckets={analytics.topTags} />
    </section>
  );
}
