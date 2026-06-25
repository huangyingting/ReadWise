import { cn } from "@/lib/cn";

/**
 * Wraps admin filter controls in a `<form method="get">` with the shared flex
 * layout. Children should be `Input`, `Select`, checkboxes, and a submit
 * `Button` — all from `src/components/ui`.
 */
export function AdminFilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form
      method="get"
      className={cn("flex flex-wrap gap-[var(--space-2)] items-center", className)}
    >
      {children}
    </form>
  );
}
