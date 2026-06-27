import { cn } from "@/lib/cn";
import { TableSurface } from "@/components/ui";

/**
 * Horizontally-scrollable admin table wrapper. Pass `<thead>` and `<tbody>`
 * as children — the `<table className="admin-table">` is rendered here so
 * every admin table gets a consistent container without repeating the wrapper
 * div.
 */
export function AdminTableWrap({
  children,
  ariaLabel,
  className,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <TableSurface
      density="compact"
      className={cn("admin-table-wrap", className)}
      tabIndex={0}
      aria-label={ariaLabel}
    >
      <table className="admin-table">{children}</table>
    </TableSurface>
  );
}
