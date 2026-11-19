import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type NoticeTone = "neutral" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<NoticeTone, string> = {
  neutral: "border-border bg-bg-subtle text-text-muted",
  success:
    "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success-text",
  warning:
    "border-[color-mix(in_srgb,var(--warning)_34%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-warning-text",
  danger:
    "border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger-text",
};

const TONE_ICONS: Record<NoticeTone, typeof Info> = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  /** Trailing controls (e.g. Dismiss / Refresh buttons). */
  action?: ReactNode;
  className?: string;
}

/**
 * Inline status message box (form errors, mutation outcomes, stale-data
 * warnings). Warning and danger notices are announced as alerts; neutral and
 * success notices as polite status updates.
 */
export function Notice({ tone, children, action, className }: NoticeProps) {
  const Icon = TONE_ICONS[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border p-[var(--space-3)] text-[length:var(--text-sm)]",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon size={16} aria-hidden className="shrink-0 translate-y-[calc(var(--space-1)/4)]" />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="flex shrink-0 gap-[var(--space-2)]">{action}</div> : null}
    </div>
  );
}
