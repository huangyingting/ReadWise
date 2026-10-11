import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getAdminOverview, statusBadgeVariant } from "@/lib/admin/overview";
import { Badge, Metric, MetricStrip, Section } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin";
import { cn } from "@/lib/cn";

const OVERVIEW_STATS = [
  ["Total members", "users"],
  ["Admins", "admins"],
  ["Articles", "articles"],
  ["Published", "published"],
  ["Tags", "tags"],
  ["Reads tracked", "readingProgress"],
] as const;

type StatusTone = ReturnType<typeof statusBadgeVariant>;

const STATUS_SEGMENT_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-[var(--border-strong)]",
};

type StatusCount = Awaited<ReturnType<typeof getAdminOverview>>["statusCounts"][number];

/**
 * Article pipeline distribution: one proportional bar for the at-a-glance mix,
 * then a legend row per status with its exact count.
 */
function ProcessingStatus({ statusCounts }: { statusCounts: StatusCount[] }) {
  const total = statusCounts.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div
        className="flex h-2 w-full overflow-hidden rounded-[var(--radius-full)] bg-bg-subtle"
        aria-hidden
      >
        {statusCounts.map((s) => (
          <span
            key={s.status}
            className={cn("h-full", STATUS_SEGMENT_CLASS[statusBadgeVariant(s.status)])}
            style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-[var(--space-6)] gap-y-[var(--space-2)] p-0">
        {statusCounts.map((s) => (
          <li key={s.status} className="flex items-center gap-[var(--space-2)]">
            <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
            <strong className="tabular-nums">{s.count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function AdminPage() {
  const session = await requireCapability(CAPABILITIES.adminAccess, "/admin");
  const overview = await getAdminOverview();

  return (
    <section className="stack">
      <AdminPageHeader
        subtitle={
          <>
            Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
            ({session.user.role})
          </>
        }
      >
        Dashboard
      </AdminPageHeader>

      <Section title="Overview" density="compact">
        <MetricStrip columns={6}>
          {OVERVIEW_STATS.map(([label, key]) => (
            <Metric key={key} label={label} value={overview[key]} />
          ))}
        </MetricStrip>
      </Section>

      <Section title="Processing status" surface="card" density="compact">
        {overview.statusCounts.length === 0 ? (
          <p className="m-0 text-text-muted">No articles yet.</p>
        ) : (
          <ProcessingStatus statusCounts={overview.statusCounts} />
        )}
      </Section>
    </section>
  );
}
