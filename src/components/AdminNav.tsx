"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select, navItemVariants } from "@/components/ui";

interface AdminSection {
  href: string;
  label: string;
}

interface AdminSectionGroup {
  label: string;
  sections: readonly AdminSection[];
}

const SECTION_GROUPS = [
  {
    label: "Insights",
    sections: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/analytics", label: "Analytics" },
    ],
  },
  {
    label: "Content",
    sections: [
      { href: "/admin/articles", label: "Articles" },
      { href: "/admin/series", label: "Series" },
      { href: "/admin/sources", label: "Sources" },
      { href: "/admin/discovery-sources", label: "Discovery" },
      { href: "/admin/candidates", label: "Review" },
      { href: "/admin/canonical-conflicts", label: "Conflicts" },
      { href: "/admin/deleted-articles", label: "Deleted" },
      { href: "/admin/tags", label: "Tags" },
    ],
  },
  {
    label: "People",
    sections: [
      { href: "/admin/members", label: "Members" },
      { href: "/admin/invitations", label: "Invitations" },
      { href: "/admin/organizations", label: "Organizations" },
    ],
  },
  {
    label: "Operations",
    sections: [
      { href: "/admin/reports", label: "Reports" },
      { href: "/admin/jobs", label: "Jobs" },
      { href: "/admin/security", label: "Security" },
    ],
  },
] satisfies readonly AdminSectionGroup[];

const SECTIONS: readonly AdminSection[] = SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

function isSectionActive(pathname: string, sectionHref: string) {
  return sectionHref === "/admin"
    ? pathname === "/admin"
    : pathname === sectionHref || pathname.startsWith(`${sectionHref}/`);
}

/**
 * Admin section navigation, grouped by domain (Insights · Content · People ·
 * Operations). One DOM, three layouts driven by `.admin-subnav*` CSS:
 * a compact section picker on mobile, wrapping tabs on tablets, and a sticky
 * grouped rail beside the page content on lg+. The active link is marked with
 * `aria-current`.
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
          selectSize="sm"
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
        {SECTION_GROUPS.map((group) => (
          <div
            key={group.label}
            className="admin-subnav-group"
            role="group"
            aria-label={group.label}
          >
            <span className="admin-subnav-group-label" aria-hidden>
              {group.label}
            </span>
            {group.sections.map((section) => {
              const isActive = isSectionActive(pathname, section.href);

              return (
                <Link
                  key={section.href}
                  href={section.href}
                  className={navItemVariants({ active: isActive })}
                  aria-current={isActive ? "page" : undefined}
                >
                  {section.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
