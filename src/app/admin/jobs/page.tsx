import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { listAdminJobs, getJobDashboard, type AdminJobRow } from "@/lib/admin-jobs";
import { JobStatus, JobType } from "@prisma/client";
import AdminJobActions from "@/components/AdminJobActions";
import AdminBackfillForm from "@/components/AdminBackfillForm";
import { AdminStatCard } from "@/components/AdminStatCard";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Card, CardTitle } from "@/components/ui/Card";

type SearchParams = {
  status?: string;
  type?: string;
  articleId?: string;
  reason?: string;
  stuck?: string;
  page?: string;
};

const STATUS_VALUES = Object.values(JobStatus);
const TYPE_VALUES = Object.values(JobType);
const TERMINAL = new Set<string>([JobStatus.COMPLETED, JobStatus.DEAD_LETTER]);

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === JobStatus.COMPLETED) return "success";
  if (status === JobStatus.DEAD_LETTER || status === JobStatus.FAILED) return "danger";
  if (status === JobStatus.RUNNING || status === JobStatus.CLAIMED) return "warning";
  return "neutral";
}

function fmtTime(value: Date | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function fmtAge(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function buildHref(sp: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value !== undefined && value !== "" && !(key === "page" && value === 1)) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `/admin/jobs?${qs}` : "/admin/jobs";
}

function JobsTable({ jobs }: { jobs: AdminJobRow[] }) {
  return (
    <div className="admin-table-wrap" tabIndex={0} aria-label="Jobs table (scrollable)">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Type / Article</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Lock age</th>
            <th>Created</th>
            <th>Last error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const canRetry =
              job.status === JobStatus.FAILED || job.status === JobStatus.DEAD_LETTER;
            const canCancel = !TERMINAL.has(job.status);
            const canArchive = TERMINAL.has(job.status);
            return (
              <tr key={job.id}>
                <td>
                  <div className="font-medium">{job.type}</div>
                  {job.articleId ? (
                    <Link
                      href={`/admin/articles/${job.articleId}`}
                      className="text-primary-text hover:underline text-[length:var(--text-sm)]"
                    >
                      {job.feature ? `${job.feature} · ` : ""}
                      {job.articleId}
                    </Link>
                  ) : (
                    <span className="muted text-[length:var(--text-sm)]">
                      {job.dedupeKey ?? job.id}
                    </span>
                  )}
                </td>
                <td>
                  <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                </td>
                <td>
                  {job.attempts}/{job.maxAttempts}
                </td>
                <td className="muted">{fmtAge(job.lockAgeMs)}</td>
                <td className="muted">{fmtTime(job.createdAt)}</td>
                <td className="text-danger-text text-[length:var(--text-sm)]">
                  {job.lastError ?? "—"}
                </td>
                <td>
                  <AdminJobActions
                    jobId={job.id}
                    canRetry={canRetry}
                    canCancel={canCancel}
                    canArchive={canArchive}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.jobsManage, "/admin/jobs");

  const sp = await searchParams;
  const status = (sp.status ?? "").trim();
  const type = (sp.type ?? "").trim();
  const articleId = (sp.articleId ?? "").trim();
  const reason = (sp.reason ?? "").trim();
  const stuck = sp.stuck === "1";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [result, dashboard] = await Promise.all([
    listAdminJobs({ status, type, articleId, failureReason: reason, stuck, page }),
    getJobDashboard(),
  ]);

  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="stack">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Jobs
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-4)]">
        <AdminStatCard label="Total jobs" value={dashboard.total} />
        {STATUS_VALUES.map((s) => (
          <AdminStatCard key={s} label={s} value={dashboard.byStatus[s] ?? 0} />
        ))}
        <AdminStatCard label="Stuck / locked" value={dashboard.stuck} />
      </div>

      <Card>
        <div className="stack">
          <CardTitle level="h3">Backfill &amp; rebuild</CardTitle>
          <p className="muted" style={{ margin: 0 }}>
            Enqueue controlled, capped jobs to (re)generate derived content. Use{" "}
            <strong>Dry run</strong> first to preview the plan. Rebuilds clear cached
            AI content only — never saved words or reading progress.
          </p>
          <AdminBackfillForm />
        </div>
      </Card>

      <form method="get" className="flex flex-wrap gap-[var(--space-2)] items-center">
        <Select
          name="status"
          defaultValue={status}
          selectSize="md"
          className="w-auto"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          name="type"
          defaultValue={type}
          selectSize="md"
          className="w-auto"
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {TYPE_VALUES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          name="articleId"
          defaultValue={articleId}
          placeholder="Article id…"
          inputSize="md"
          className="flex-[1_1_180px]"
          aria-label="Filter by article id"
        />
        <Input
          type="search"
          name="reason"
          defaultValue={reason}
          placeholder="Failure reason…"
          inputSize="md"
          className="flex-[1_1_180px]"
          aria-label="Filter by failure reason"
        />
        <label className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)]">
          <input type="checkbox" name="stuck" value="1" defaultChecked={stuck} />
          Stuck only
        </label>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Filter
        </Button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No jobs match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.jobs.length > 0 && <JobsTable jobs={result.jobs} />}

      {result.totalPages > 1 && (
        <div className="admin-pagination">
          {result.page > 1 ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildHref({
                status,
                type,
                articleId,
                reason,
                stuck: stuck ? 1 : undefined,
                page: result.page - 1,
              })}
            >
              ← Previous
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              ← Previous
            </Button>
          )}
          <span className="muted">
            Page {result.page} of {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildHref({
                status,
                type,
                articleId,
                reason,
                stuck: stuck ? 1 : undefined,
                page: result.page + 1,
              })}
            >
              Next →
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next →
            </Button>
          )}
        </div>
      )}

      {dashboard.deadLetter.length > 0 && (
        <Card>
          <div className="stack">
            <CardTitle level="h3">Recent dead-letter jobs</CardTitle>
            <JobsTable jobs={dashboard.deadLetter} />
          </div>
        </Card>
      )}
    </section>
  );
}
