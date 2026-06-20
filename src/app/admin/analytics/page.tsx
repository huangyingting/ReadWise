import { requireAdmin } from "@/lib/session";
import { getAdminAnalytics } from "@/lib/admin-analytics";
import { AdminStatCard } from "@/components/AdminStatCard";
import { BarChart } from "@/components/admin/BarChart";

export default async function AdminAnalyticsPage() {
  await requireAdmin("/admin/analytics");
  const analytics = await getAdminAnalytics();
  const { memberActivity } = analytics;

  /** Reading funnel: members → active readers → reads tracked → completed */
  const readingFunnel = [
    { key: "total", label: "Total members", count: memberActivity.totalMembers },
    { key: "active", label: "Active readers", count: memberActivity.activeReaders },
    { key: "reads", label: "Reads tracked", count: memberActivity.readsTracked },
    { key: "completed", label: "Completed reads", count: memberActivity.completedReads },
    { key: "saved", label: "Saved words", count: memberActivity.savedWords },
  ];

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
        Reading funnel
      </h2>
      <BarChart title="Reading funnel" buckets={readingFunnel} />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Articles by category
      </h2>
      <BarChart title="Articles by category" buckets={analytics.articlesByCategory} />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Articles by level
      </h2>
      <BarChart title="Articles by level" buckets={analytics.articlesByLevel} />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Top tags
      </h2>
      <BarChart title="Top tags" buckets={analytics.topTags} />
    </section>
  );
}
