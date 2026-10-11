import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { Metric, MetricStrip } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin";
import AdminSloDashboardPanel from "@/components/admin/security/AdminSloDashboardPanel";
import AdminSecurityEventsPanel from "@/components/admin/security/AdminSecurityEventsPanel";
import AdminAuditLogPanel from "@/components/admin/security/AdminAuditLogPanel";
import {
  csrfEnforceSameOrigin,
  isTrustedProxyConfigured,
  trustedProxyConfig,
} from "@/lib/runtime-config/security";

export const dynamic = "force-dynamic";

type TrustedProxyConfig = ReturnType<typeof trustedProxyConfig>;

function formatProxyMode(proxy: TrustedProxyConfig): string {
  if (proxy.header) return `header: ${proxy.header}`;
  if (proxy.list.length > 0) return `cidr list (${proxy.list.length})`;
  if (proxy.hops !== null) return `hops: ${proxy.hops}`;
  return "best-effort (soft)";
}

/**
 * Admin security overview (RW-029) — shows the current trusted-proxy / CSRF
 * posture plus two operator queues: the in-process security-event ring buffer
 * (filterable by type + severity) and the durable, DB-backed audit trail
 * (filterable + paginated). Both queues are client islands that fetch their
 * `security.view`-gated routes; the page gate + each route re-check the
 * capability. Lives at /admin/security (admin-gated).
 */
export default async function AdminSecurityPage() {
  await requireCapability(CAPABILITIES.securityView, "/admin/security");
  const proxy = trustedProxyConfig();
  const proxyConfigured = isTrustedProxyConfigured();
  const csrfEnforced = csrfEnforceSameOrigin();

  return (
    <section className="stack">
      <AdminPageHeader>Security</AdminPageHeader>

      <MetricStrip columns={3} aria-label="Security posture">
        <Metric
          label="Trusted proxy"
          value={proxyConfigured ? "configured" : "unconfigured"}
          tone={proxyConfigured ? "success" : "warning"}
        />
        <Metric label="Proxy mode" value={formatProxyMode(proxy)} />
        <Metric
          label="CSRF same-origin"
          value={csrfEnforced ? "enforced" : "disabled"}
          tone={csrfEnforced ? "success" : "warning"}
        />
      </MetricStrip>

      <h2 className="m-0 font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-section-title)] text-text">
        Service-level objectives
      </h2>
      <AdminSloDashboardPanel />

      <h2 className="m-0 font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-section-title)] text-text">
        Recent security events
      </h2>
      <AdminSecurityEventsPanel />

      <h2 className="m-0 font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-section-title)] text-text">
        Audit log
      </h2>
      <AdminAuditLogPanel />
    </section>
  );
}
