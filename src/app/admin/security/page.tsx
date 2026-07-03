import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getRecentSecurityEvents } from "@/lib/security/events";
import { StatCard } from "@/components/analytics/StatCard";
import { AdminTableWrap } from "@/components/admin";
import {
  csrfEnforceSameOrigin,
  isTrustedProxyConfigured,
  trustedProxyConfig,
} from "@/lib/runtime-config/security";

export const dynamic = "force-dynamic";

const SECURITY_EVENT_LIMIT = 100;
const EMPTY_CELL = "—";
const EVENT_HEADERS = [
  "Time",
  "Type",
  "Severity",
  "Status",
  "Route",
  "Actor",
  "IP",
  "Count",
] as const;

type TrustedProxyConfig = ReturnType<typeof trustedProxyConfig>;
type SecurityEvent = ReturnType<typeof getRecentSecurityEvents>[number];

function formatProxyMode(proxy: TrustedProxyConfig): string {
  if (proxy.header) return `header: ${proxy.header}`;
  if (proxy.list.length > 0) return `cidr list (${proxy.list.length})`;
  if (proxy.hops !== null) return `hops: ${proxy.hops}`;
  return "best-effort (soft)";
}

function formatSecurityEventTime(timestamp: SecurityEvent["timestamp"]): string {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
}

function cellValue(value: string | number | null | undefined) {
  return value ?? EMPTY_CELL;
}

/**
 * Admin security overview (RW-029) — shows the current trusted-proxy / CSRF
 * posture plus the most recent security events from the in-process ring buffer.
 * For durable history, forward the structured `security.event` logs / metrics to
 * a SIEM (see docs/security/overview.md). Lives at /admin/security (admin-gated).
 */
export default async function AdminSecurityPage() {
  await requireCapability(CAPABILITIES.securityView, "/admin/security");
  const events = getRecentSecurityEvents(SECURITY_EVENT_LIMIT);
  const proxy = trustedProxyConfig();

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
        <StatCard label="Proxy mode" value={formatProxyMode(proxy)} />
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
        <AdminTableWrap ariaLabel="Recent security events (scrollable)">
          <thead>
            <tr>
              {EVENT_HEADERS.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={`${event.timestamp}-${index}`}>
                <td>{formatSecurityEventTime(event.timestamp)}</td>
                <td>{event.type}</td>
                <td>{event.severity}</td>
                <td>{cellValue(event.status)}</td>
                <td>{cellValue(event.route)}</td>
                <td>{cellValue(event.actorId)}</td>
                <td>{cellValue(event.ip)}</td>
                <td>{event.count}</td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      )}
    </section>
  );
}
