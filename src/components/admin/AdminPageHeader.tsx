import { cn } from "@/lib/cn";

interface AdminPageHeaderProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}

const ADMIN_TITLE_CLASS =
  "m-0 font-[family-name:var(--font-display)] text-[length:var(--type-page-title-compact)] font-semibold leading-[var(--leading-snug)] tracking-[-0.01em] text-text";

/**
 * Shared admin page `<h1>` using the compact page-title role. Title, actions,
 * and subtitle share one header row so admin pages start with content, not
 * whitespace.
 */
export function AdminPageHeader({
  children,
  actions,
  subtitle,
  className,
}: AdminPageHeaderProps) {
  const title = <h1 className={cn(ADMIN_TITLE_CLASS, className)}>{children}</h1>;

  if (!actions && !subtitle) {
    return title;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-[var(--space-4)] gap-y-[var(--space-2)]">
      <div className="min-w-0">
        {title}
        {subtitle ? (
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--type-ui)] text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
