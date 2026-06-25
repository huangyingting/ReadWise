/**
 * DashboardBrowseCta — "Looking for something specific?" card linking to the
 * browse page (REF-059).
 */
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui";

export function DashboardBrowseCta() {
  return (
    <section className="mt-[var(--space-7)]">
      <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-[var(--space-4)]">
          <div>
            <p className="font-semibold text-text m-0">Looking for something specific?</p>
            <p className="text-text-muted text-[length:var(--text-sm)] m-0">
              Explore every category and your topic Picks.
            </p>
          </div>
          <Link
            href="/browse"
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            Browse by topic <span aria-hidden="true">→</span>
          </Link>
        </div>
      </Card>
    </section>
  );
}
