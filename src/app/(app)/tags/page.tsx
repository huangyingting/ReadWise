import type { Metadata } from "next";
import { Hash } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listTagsWithCounts } from "@/lib/tags";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";
import EmptyState from "@/components/EmptyState";
import { tags } from "@/lib/copy/pages";

export const metadata: Metadata = tags;

export default async function TagsPage() {
  await requireSession("/tags");
  const tags = await listTagsWithCounts();

  return (
    <PageShell variant="listing">
      <PageHeader
        title="Tags"
        description="Browse articles by tag. Each tag links to its collection of published articles."
      />

      {tags.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No tags yet"
          description="Tags are added automatically as articles are processed. Check back after some articles have been published."
          action={{ label: "Browse all articles", href: "/browse" }}
        />
      ) : (
        <div className="flex flex-wrap gap-[var(--space-3)]">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/tags/${tag.slug}`}
              className="tag-chip text-text"
            >
              {tag.name}
              <span className="ml-1 text-text-muted">({tag.articleCount})</span>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
