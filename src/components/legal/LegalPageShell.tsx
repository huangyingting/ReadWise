/**
 * Shared scaffolding for static legal pages (Terms, Privacy Policy).
 *
 * Extracts the common outer structure — container sizing, heading, "last
 * updated" line, section wrapper, and back-to-home link — so each legal page
 * only needs to provide its heading, date stamp, and section content.
 *
 * Rendered output is byte-identical to the original per-page markup.
 * Metadata is still exported by each page via `@/lib/copy/pages`.
 *
 * REF-075 — Consolidate legal/static pages, metadata, and manifest content
 * governance.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader, PageShell, Stack, buttonVariants } from "@/components/ui";

interface LegalPageShellProps {
  /** Page heading — e.g. "Terms of Service" or "Privacy Policy". */
  heading: string;
  /** "Last updated: …" stamp — e.g. "Last updated: June 2025". */
  lastUpdated: string;
  /** `<section>` elements that make up the page body. */
  children: ReactNode;
}

export function LegalPageShell({
  heading,
  lastUpdated,
  children,
}: LegalPageShellProps) {
  return (
    <PageShell as="main" variant="narrow">
      <PageHeader title={heading} description={lastUpdated} />

      <Stack gap="6">{children}</Stack>

      <p className="mt-[var(--space-7)]">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Back to ReadWise
        </Link>
      </p>
    </PageShell>
  );
}
