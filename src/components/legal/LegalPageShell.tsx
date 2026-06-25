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
    <main className="container" style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1
        className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-3xl)] text-text"
        style={{ marginBottom: "0.5rem" }}
      >
        {heading}
      </h1>
      <p className="text-text-subtle text-[length:var(--text-sm)]" style={{ marginBottom: "2rem" }}>
        {lastUpdated}
      </p>

      <div className="stack">{children}</div>

      <p style={{ marginTop: "2rem" }}>
        <Link href="/" className="text-primary-text hover:underline">
          ← Back to ReadWise
        </Link>
      </p>
    </main>
  );
}
