import { cn } from "@/lib/cn";

interface AdminPageHeaderProps {
  children: React.ReactNode;
  className?: string;
}

/** Shared admin page `<h1>` with consistent display-font styling. */
export function AdminPageHeader({
  children,
  className,
}: AdminPageHeaderProps) {
  return (
    <h1
      className={cn(
        "m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text",
        className,
      )}
    >
      {children}
    </h1>
  );
}
