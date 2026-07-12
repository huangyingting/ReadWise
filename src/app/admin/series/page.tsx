import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { listSeriesForAdmin } from "@/lib/engagement/series";
import AdminSeriesCreate from "@/components/AdminSeriesCreate";
import AdminSeriesRowActions from "@/components/AdminSeriesRowActions";
import { AdminPageHeader, AdminTableWrap } from "@/components/admin";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen } from "lucide-react";
import type { BadgeProps } from "@/components/ui/Badge";

const STATUS_BADGE: Record<string, BadgeProps["variant"]> = {
  draft: "neutral",
  active: "success",
  archived: "warning",
};

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_BADGE[status] ?? "neutral";
  return (
    <Badge variant={variant} uppercase>
      {status}
    </Badge>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function AdminSeriesPage() {
  await requireCapability(CAPABILITIES.articlesManage, "/admin/series");

  const rows = await listSeriesForAdmin();

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <AdminPageHeader>Reading series</AdminPageHeader>
        <AdminSeriesCreate />
      </div>

      <p className="muted" style={{ margin: 0 }}>
        Curated reading series for learners. Draft series are not visible to
        learners; activate to publish.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No series yet"
          description="Create a curated reading series to guide learners through themed article collections."
          titleAs="p"
        />
      ) : (
        <AdminTableWrap ariaLabel="Reading series">
          <thead>
            <tr>
              <th scope="col" className="admin-th">Title</th>
              <th scope="col" className="admin-th">Slug</th>
              <th scope="col" className="admin-th">Status</th>
              <th scope="col" className="admin-th admin-th-num">Articles</th>
              <th scope="col" className="admin-th">Public</th>
              <th scope="col" className="admin-th">Created</th>
              <th scope="col" className="admin-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((series) => (
              <tr key={series.id} className="admin-row">
                <td className="admin-td font-medium text-text">
                  {series.title}
                </td>
                <td className="admin-td text-text-subtle font-mono text-[length:var(--text-xs)]">
                  {series.slug}
                </td>
                <td className="admin-td">
                  <StatusBadge status={series.status} />
                </td>
                <td className="admin-td admin-td-num tabular-nums">
                  {series.articleCount}
                </td>
                <td className="admin-td text-text-subtle">
                  {series.public ? "Yes" : "No"}
                </td>
                <td className="admin-td text-text-subtle text-[length:var(--text-xs)]">
                  {formatDate(series.createdAt)}
                </td>
                <td className="admin-td">
                  <AdminSeriesRowActions
                    series={{
                      id: series.id,
                      slug: series.slug,
                      title: series.title,
                      description: series.description,
                      topic: series.topic,
                      targetLevelMin: series.targetLevelMin,
                      targetLevelMax: series.targetLevelMax,
                      status: series.status,
                      public: series.public,
                      articleCount: series.articleCount,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      )}
    </section>
  );
}
