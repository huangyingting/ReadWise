import { cn } from "@/lib/cn";

interface AdminPageHeaderProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}

/** Shared admin page `<h1>` with consistent display-font styling. */
export function AdminPageHeader({
  children,
  actions,
  subtitle,
  className,
}: AdminPageHeaderProps) {
  const title = (
    <h1
      className={cn(
        "m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text",
        className,
      )}
    >
      {children}
    </h1>
  );

  if (!actions && !subtitle) {
    return title;
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        {title}
        {actions ? <div>{actions}</div> : null}
      </div>
      {subtitle ? <p className="muted m-0">{subtitle}</p> : null}
    </div>
  );
}
