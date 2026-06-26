import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getRecentSecurityEvents } from "@/lib/security/events";
import { StatCard } from "@/components/analytics/StatCard";
import {
  csrfEnforceSameOrigin,
  isTrustedProxyConfigured,
  trustedProxyConfig,
} from "@/lib/runtime-config/security";

export const dynamic = "force-dynamic";

/**
 * Admin security overview (RW-029) — shows the current trusted-proxy / CSRF
 * posture plus the most recent security events from the in-process ring buffer.
 * For durable history, forward the structured `security.event` logs / metrics to
 * a SIEM (see docs/security/overview.md). Lives at /admin/security (admin-gated).
 */
export default async function AdminSecurityPage() {
  await requireCapability(CAPABILITIES.securityView, "/admin/security");
  const events = getRecentSecurityEvents(100);
  const proxy = trustedProxyConfig();

  const proxyMode = proxy.header
    ? `header: ${proxy.header}`
    : proxy.list.length > 0
      ? `cidr list (${proxy.list.length})`
      : proxy.hops !== null
        ? `hops: ${proxy.hops}`
        : "best-effort (soft)";

  return (
    <section className="stack">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Security
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
        <StatCard
          label="Trusted proxy"
          value={isTrustedProxyConfigured() ? "configured" : "unconfigured"}
        />
        <StatCard label="Proxy mode" value={proxyMode} />
        <StatCard
          label="CSRF same-origin"
          value={csrfEnforceSameOrigin() ? "enforced" : "disabled"}
        />
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Recent security events
      </h2>
      {events.length === 0 ? (
        <p className="text-text-muted">
          No security events recorded in this process yet.
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Route</th>
                <th>Actor</th>
                <th>IP</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={`${event.timestamp}-${index}`}>
                  <td>
                    {new Date(event.timestamp)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}
                  </td>
                  <td>{event.type}</td>
                  <td>{event.severity}</td>
                  <td>{event.status ?? "—"}</td>
                  <td>{event.route ?? "—"}</td>
                  <td>{event.actorId ?? "—"}</td>
                  <td>{event.ip ?? "—"}</td>
                  <td>{event.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
