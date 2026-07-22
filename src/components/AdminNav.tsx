"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui";
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
  { href: "/admin/discovery-sources", label: "Discovery" },
  { href: "/admin/candidates", label: "Review" },
  { href: "/admin/canonical-conflicts", label: "Conflicts" },
  { href: "/admin/deleted-articles", label: "Deleted" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/tags", label: "Tags" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/organizations", label: "Organizations" },
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
 * Admin secondary sub-nav — a compact section picker on mobile and wrapping
 * tabs at wider viewports. The active desktop tab is marked with `aria-current`.
 */
export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeSection = SECTIONS.find((section) =>
    isSectionActive(pathname, section.href),
  );

  return (
    <nav className="admin-subnav" aria-label="Admin sections">
      <div className="admin-subnav-mobile">
        <Select
          aria-label="Admin section"
          value={activeSection?.href ?? SECTIONS[0].href}
          onChange={(event) => router.push(event.currentTarget.value)}
        >
          {SECTIONS.map((section) => (
            <option key={section.href} value={section.href}>
              {section.label}
            </option>
          ))}
        </Select>
      </div>

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
