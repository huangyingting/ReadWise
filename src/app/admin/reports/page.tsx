import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  listContentReports,
  ContentReportStatus,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  isReportStatus,
  type ContentReportRow,
} from "@/lib/moderation/reports";
import { Badge, Button, Select, type BadgeProps } from "@/components/ui";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminResultCount,
  AdminTableWrap,
  AdminPagination,
} from "@/components/admin";
import { formatDateTime } from "@/lib/display-format";

type SearchParams = { status?: string; page?: string };

const PAGE_SIZE = 25;

function statusVariant(status: ContentReportStatus): BadgeProps["variant"] {
  switch (status) {
    case ContentReportStatus.OPEN: return "danger";
    case ContentReportStatus.REVIEWING: return "warning";
    case ContentReportStatus.RESOLVED: return "success";
    case ContentReportStatus.DISMISSED: return "neutral";
  }
}

function buildHref(params: { status: string; page: number }): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/reports?${qs}` : "/admin/reports";
}

function ReportsTable({ reports }: { reports: ContentReportRow[] }) {
  if (reports.length === 0) {
    return <p className="text-text-muted text-[length:var(--text-sm)]">No reports found.</p>;
  }
  return (
    <AdminTableWrap ariaLabel="Content reports table (scrollable)">
      <thead>
        <tr>
          <th>Article</th>
          <th>Reason</th>
          <th>Note</th>
          <th>Status</th>
          <th>Reported</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <tr key={r.id}>
            <td>
              <Link
                href={`/admin/articles/${r.articleId}`}
                className="text-link hover:underline"
              >
                {r.articleTitle ?? r.articleId}
              </Link>
            </td>
            <td>{REPORT_REASON_LABELS[r.reason]}</td>
            <td className="max-w-xs truncate text-[length:var(--text-sm)] text-text-muted">{r.note ?? "—"}</td>
            <td>
              <Badge variant={statusVariant(r.status)}>
                {REPORT_STATUS_LABELS[r.status]}
              </Badge>
            </td>
            <td className="text-[length:var(--text-sm)] text-text-muted">{formatDateTime(r.createdAt)}</td>
            <td>
              <div className="flex flex-wrap gap-[var(--space-2)]">
                {r.status === ContentReportStatus.OPEN ||
                r.status === ContentReportStatus.REVIEWING ? (
                  <>
                    <form method="POST" action={`/api/admin/reports/${r.id}`}>
                      <input type="hidden" name="_method" value="PATCH" />
                      <input type="hidden" name="status" value={ContentReportStatus.RESOLVED} />
                      <Button type="submit" size="sm" variant="secondary">
                        Resolve
                      </Button>
                    </form>
                    <form method="POST" action={`/api/admin/reports/${r.id}`}>
                      <input type="hidden" name="_method" value="PATCH" />
                      <input type="hidden" name="status" value={ContentReportStatus.DISMISSED} />
                      <Button type="submit" size="sm" variant="outline">
                        Dismiss
                      </Button>
                    </form>
                  </>
                ) : (
                  <span className="text-[length:var(--text-sm)] text-text-muted">
                    {r.resolvedAt ? formatDateTime(r.resolvedAt) : "—"}
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.contentModerate, "/admin/reports");

  const sp = await searchParams;
  const rawStatus = (sp.status ?? "").trim().toLowerCase();
  const status = isReportStatus(rawStatus)
    ? (rawStatus as ContentReportStatus)
    : ContentReportStatus.OPEN;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const { reports, total, pageCount } = await listContentReports({
    status,
    page,
    pageSize: PAGE_SIZE,
  });

  const ALL_STATUSES = Object.values(ContentReportStatus);

  return (
    <section className="stack">
      <AdminPageHeader>Content Reports</AdminPageHeader>

      <AdminFilterBar>
        <Select
          name="status"
          defaultValue={status}
          selectSize="md"
          className="w-auto"
          aria-label="Filter by status"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </AdminFilterBar>

      <AdminResultCount total={total} page={page} pageSize={PAGE_SIZE} noun="report" />

      <ReportsTable reports={reports} />

      {pageCount > 1 && (
        <AdminPagination
          page={page}
          totalPages={pageCount}
          buildHref={(p) => buildHref({ status, page: p })}
        />
      )}
    </section>
  );
}
