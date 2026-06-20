import { requireAdmin } from "@/lib/session";
import { getAdminAnalytics, type BucketCount } from "@/lib/admin-analytics";
import { Card } from "@/components/ui/Card";
import { AdminStatCard } from "@/components/AdminStatCard";

function BarChart({ buckets }: { buckets: BucketCount[] }) {
  if (buckets.length === 0) {
    return <p className="muted">No data yet.</p>;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <Card>
      <div className="stack">
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
    </Card>
  );
}

export default async function AdminAnalyticsPage() {
  await requireAdmin("/admin/analytics");
  const analytics = await getAdminAnalytics();
  const { memberActivity } = analytics;

  return (
    <section className="stack mt-[var(--space-6)]">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Analytics
      </h1>
      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Member activity
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
        <AdminStatCard label="Total members" value={memberActivity.totalMembers} />
        <AdminStatCard label="Active readers" value={memberActivity.activeReaders} />
        <AdminStatCard label="Reads tracked" value={memberActivity.readsTracked} />
        <AdminStatCard
          label="Completed reads"
          value={memberActivity.completedReads}
        />
        <AdminStatCard label="Saved words" value={memberActivity.savedWords} />
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Articles by category
      </h2>
      <BarChart buckets={analytics.articlesByCategory} />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Articles by level
      </h2>
      <BarChart buckets={analytics.articlesByLevel} />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Top tags
      </h2>
      <BarChart buckets={analytics.topTags} />
    </section>
  );
}
