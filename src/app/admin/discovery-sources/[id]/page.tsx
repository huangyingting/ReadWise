import type { ReactNode } from "react";
import Link from "next/link";
import { CrawlCandidateStatus } from "@prisma/client";

import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getDiscoverySourceMetrics,
  type DiscoverySourceMetricsDto,
} from "@/lib/scraper/incremental/observability-query";
import { enabledLifecycleActions } from "@/lib/scraper/incremental/lifecycle-action-eligibility";
import AdminDiscoverySourceActions from "@/components/AdminDiscoverySourceActions";
import { AdminPageHeader, AdminTableWrap } from "@/components/admin";
import { Badge, Card, CardBody, CardTitle } from "@/components/ui";
import {
  DiscoverySourceStatusBadge,
  gapBadgeVariant,
  healthBadgeVariant,
} from "@/components/DiscoverySourceStatusBadge";
import { formatAgeSeconds, formatDateTime } from "@/lib/display-format";

const DASH = "—";
const CANDIDATE_STATUSES = Object.values(CrawlCandidateStatus);

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted text-[length:var(--text-sm)]">{label}</dt>
      <dd className="m-0 font-medium">{children}</dd>
    </div>
  );
}

function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)] m-0">
      {children}
    </dl>
  );
}

function maybeDate(value: Date | null): string {
  return value ? formatDateTime(value) : DASH;
}

function formatDelay(
  delay: DiscoverySourceMetricsDto["metrics"]["publicationToDiscoveryDelay"],
): string {
  if (!delay) return DASH;
  return `p50 ${formatAgeSeconds(delay.p50Seconds)} · p90 ${formatAgeSeconds(
    delay.p90Seconds,
  )} · max ${formatAgeSeconds(delay.maxSeconds)} (n=${delay.sampleCount})`;
}

function formatConflictRate(rate: number | null): string {
  return rate === null ? DASH : `${(rate * 100).toFixed(1)}%`;
}

export default async function AdminDiscoverySourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/discovery-sources");

  const { id } = await params;
  const source = await getDiscoverySourceMetrics(id);

  if (!source) {
    return <DiscoverySourceNotFound />;
  }

  const { providerKey, sourceKey, definitionVersion, metrics } = source;
  const caughtUp = metrics.status === "healthy-caught-up";
  const enabledActions = enabledLifecycleActions(metrics.lifecycleMode);

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <AdminPageHeader>
          {providerKey}/{sourceKey}
        </AdminPageHeader>
        <Link
          href="/admin/discovery-sources"
          className="text-primary-text hover:underline text-[length:var(--text-sm)]"
        >
          ← All discovery sources
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <DiscoverySourceStatusBadge status={metrics.status} />
        <Badge variant={healthBadgeVariant(metrics.health)}>{metrics.health}</Badge>
        <span className="text-text-muted text-[length:var(--text-sm)]">
          definition v{definitionVersion}
        </span>
      </div>

      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <CardTitle level="h2">Lifecycle &amp; role</CardTitle>
            <MetricGrid>
              <Metric label="Lifecycle mode">{metrics.lifecycleMode}</Metric>
              <Metric label="Automation policy">{metrics.automationPolicy}</Metric>
              <Metric label="Role">{metrics.role}</Metric>
              <Metric label="Health">{metrics.health}</Metric>
              <Metric label="Caught up">{caughtUp ? "Yes" : "No"}</Metric>
              <Metric label="Definition version">v{definitionVersion}</Metric>
            </MetricGrid>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <CardTitle level="h2">Lifecycle controls</CardTitle>
            <p className="m-0 text-text-muted text-[length:var(--text-sm)]">
              Actions not valid from the current mode are disabled. The scraper is
              the source of truth — a busy source or an illegal transition is
              rejected and reported here.
            </p>
            <AdminDiscoverySourceActions
              sourceId={id}
              enabledActions={enabledActions}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <CardTitle level="h2">Runs, watermark &amp; baseline</CardTitle>
            <MetricGrid>
              <Metric label="Last run">
                {maybeDate(metrics.lastRunAt)}
                {metrics.lastRunAgeSeconds !== null ? (
                  <span className="text-text-muted text-[length:var(--text-sm)]">
                    {" "}
                    ({formatAgeSeconds(metrics.lastRunAgeSeconds)} ago)
                  </span>
                ) : null}
              </Metric>
              <Metric label="Next run">{maybeDate(metrics.nextRunAt)}</Metric>
              <Metric label="Watermark">
                {maybeDate(metrics.watermarkAt)}
                {metrics.watermarkStallSeconds !== null ? (
                  <span className="text-text-muted text-[length:var(--text-sm)]">
                    {" "}
                    (stall {formatAgeSeconds(metrics.watermarkStallSeconds)})
                  </span>
                ) : null}
              </Metric>
              <Metric label="Baseline completed">
                {maybeDate(metrics.baselineCompletedAt)}
              </Metric>
              <Metric label="Baseline observed">
                {metrics.baselineObservedCount}
              </Metric>
              <Metric label="Activated">{maybeDate(metrics.activatedAt)}</Metric>
            </MetricGrid>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <CardTitle level="h2">Completeness gap</CardTitle>
            <MetricGrid>
              <Metric label="Gap state">
                {metrics.gapState === "NONE" ? (
                  "none"
                ) : (
                  <Badge variant={gapBadgeVariant(metrics.gapState)}>
                    {metrics.gapState}
                  </Badge>
                )}
              </Metric>
              <Metric label="Gap detected">
                {maybeDate(metrics.gapDetectedAt)}
              </Metric>
              <Metric label="Gap age">
                {formatAgeSeconds(metrics.gapAgeSeconds)}
              </Metric>
            </MetricGrid>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <CardTitle level="h2">Drift &amp; key metrics</CardTitle>
            <MetricGrid>
              <Metric label="Zero-discovery streak">
                {metrics.zeroDiscoveryStreak}
              </Metric>
              <Metric label="Consecutive failures">
                {metrics.consecutiveFailures}
              </Metric>
              <Metric label="Backoff level">
                {metrics.backoffLevel}
                {metrics.backoffActive ? (
                  <span className="text-danger-text text-[length:var(--text-sm)]">
                    {" "}
                    (active)
                  </span>
                ) : null}
              </Metric>
              <Metric label="Backlog">{metrics.backlogCount}</Metric>
              <Metric label="Publication → discovery delay">
                {formatDelay(metrics.publicationToDiscoveryDelay)}
              </Metric>
              <Metric label="Volume anomaly">{metrics.volumeAnomaly}</Metric>
              <Metric label="Conflict rate">
                {formatConflictRate(metrics.conflictRate)}
                <span className="text-text-muted text-[length:var(--text-sm)]">
                  {" "}
                  ({metrics.conflictCount})
                </span>
              </Metric>
              <Metric label="Validator failures">
                {metrics.validatorFailures}
              </Metric>
              <Metric label="Discovery budget / run">
                {metrics.discoveryBudgetPerRun ?? DASH}
              </Metric>
            </MetricGrid>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <CardTitle level="h2">Candidate counts</CardTitle>
            <CandidateCountsTable metrics={metrics} />
          </div>
        </CardBody>
      </Card>
    </section>
  );
}

function CandidateCountsTable({
  metrics,
}: {
  metrics: DiscoverySourceMetricsDto["metrics"];
}) {
  return (
    <AdminTableWrap ariaLabel="Candidate counts by status">
      <thead>
        <tr>
          {CANDIDATE_STATUSES.map((status) => (
            <th key={status}>{status}</th>
          ))}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          {CANDIDATE_STATUSES.map((status) => (
            <td key={status} className="text-text-muted">
              {metrics.candidateCounts[status] ?? 0}
            </td>
          ))}
          <td className="font-medium">{metrics.totalCandidates}</td>
        </tr>
      </tbody>
    </AdminTableWrap>
  );
}

function DiscoverySourceNotFound() {
  return (
    <section className="stack">
      <AdminPageHeader>Discovery source</AdminPageHeader>
      <Card>
        <CardBody className="mt-0">
          <div className="stack">
            <p className="m-0 text-text-muted" role="alert">
              Discovery source not found. It may have been removed.
            </p>
            <Link
              href="/admin/discovery-sources"
              className="text-primary-text hover:underline text-[length:var(--text-sm)]"
            >
              ← All discovery sources
            </Link>
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
