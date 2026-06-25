import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/Button";

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
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="admin-pagination">
      {page > 1 ? (
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={buildHref(page - 1)}
        >
          ← Previous
        </Link>
      ) : (
        <Button variant="outline" size="sm" disabled>
          ← Previous
        </Button>
      )}
      <span className="muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={buildHref(page + 1)}
        >
          Next →
        </Link>
      ) : (
        <Button variant="outline" size="sm" disabled>
          Next →
        </Button>
      )}
    </div>
  );
}
