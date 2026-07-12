"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavLinkVariants } from "./admin/adminNavLinkVariants";

interface AdminSection {
  href: string;
  label: string;
}

const SECTIONS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/articles", label: "Articles" },
  { href: "/admin/series", label: "Series" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/tags", label: "Tags" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/security", label: "Security" },
] satisfies readonly AdminSection[];

function isSectionActive(pathname: string, sectionHref: string) {
  return sectionHref === "/admin"
    ? pathname === "/admin"
    : pathname === sectionHref || pathname.startsWith(`${sectionHref}/`);
}

/**
 * Admin secondary sub-nav — a horizontal tab strip rendered inside the unified
 * shell, above the admin page content. Scrolls horizontally below the available
 * width (never clips items) and marks the active section with `aria-current`.
 */
export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-subnav" aria-label="Admin sections">
      <div className="admin-subnav-track">
        {SECTIONS.map((section) => {
          const isActive = isSectionActive(pathname, section.href);

          return (
            <Link
              key={section.href}
              href={section.href}
              className={adminNavLinkVariants(isActive)}
              aria-current={isActive ? "page" : undefined}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
