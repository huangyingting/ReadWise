import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/Button";

interface AdminPaginationProps {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}

function PaginationButton({
  children,
  href,
}: {
  children: React.ReactNode;
  href?: string;
}) {
  if (!href) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }

  return (
    <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href}>
      {children}
    </Link>
  );
}

/**
 * Admin list pagination controls. Renders nothing when `totalPages <= 1`.
 *
 * `buildHref` receives the target page number and must return the full URL
 * including any active filter params.
 */
export function AdminPagination({
  page,
  totalPages,
  buildHref,
}: AdminPaginationProps) {
  if (totalPages <= 1) return null;

  const previousHref = page > 1 ? buildHref(page - 1) : undefined;
  const nextHref = page < totalPages ? buildHref(page + 1) : undefined;

  return (
    <div className="admin-pagination">
      <PaginationButton href={previousHref}>
        ← Previous
      </PaginationButton>
      <span className="muted">
        Page {page} of {totalPages}
      </span>
      <PaginationButton href={nextHref}>
        Next →
      </PaginationButton>
    </div>
  );
}
