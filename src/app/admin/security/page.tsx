import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { StatCard } from "@/components/analytics/StatCard";
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

  return (
    <section className="stack">
      <AdminPageHeader>Security</AdminPageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
        <StatCard
          label="Trusted proxy"
          value={isTrustedProxyConfigured() ? "configured" : "unconfigured"}
        />
        <StatCard label="Proxy mode" value={formatProxyMode(proxy)} />
        <StatCard
          label="CSRF same-origin"
          value={csrfEnforceSameOrigin() ? "enforced" : "disabled"}
        />
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Service-level objectives
      </h2>
      <AdminSloDashboardPanel />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Recent security events
      </h2>
      <AdminSecurityEventsPanel />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Audit log
      </h2>
      <AdminAuditLogPanel />
    </section>
  );
}
