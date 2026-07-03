import Link from "next/link";
import { FileText, StickyNote } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { listAllUserHighlights, HIGHLIGHT_COLORS } from "@/lib/annotations";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";
import InlineNoteEditor from "@/components/InlineNoteEditor";
import ReferrerLink from "@/components/ReferrerLink";
import { cn } from "@/lib/cn";
import { notes } from "@/lib/copy/pages";
import { formatShortDate } from "@/lib/display-format";

export const metadata = notes;

// Map colour label → CSS custom-highlight colour token (graceful fallback)
const COLOR_DOT: Record<string, string> = {
  yellow: "var(--hl-dot-yellow)",
  green: "var(--hl-dot-green)",
  blue: "var(--hl-dot-blue)",
  pink: "var(--hl-dot-pink)",
};

type Highlight = Awaited<ReturnType<typeof listAllUserHighlights>>[number];

type HighlightGroup = {
  title: string;
  items: Highlight[];
};

function normalizeColorFilter(color: string | undefined): string | null {
  return color && (HIGHLIGHT_COLORS as readonly string[]).includes(color)
    ? color
    : null;
}

function highlightMatchesFilter(
  highlight: Highlight,
  colorFilter: string | null,
  query: string,
) {
  if (colorFilter && highlight.color !== colorFilter) {
    return false;
  }

  if (!query) {
    return true;
  }

  const haystack = `${highlight.quote} ${highlight.note ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

function groupHighlightsByArticle(highlights: Highlight[]) {
  const groups = new Map<string, HighlightGroup>();

  for (const highlight of highlights) {
    const key = highlight.article.id;
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(highlight);
    } else {
      groups.set(key, {
        title: highlight.article.title,
        items: [highlight],
      });
    }
  }

  return groups;
}

function colorFilterHref(color: string, query: string) {
  return `/notes?color=${color}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
}

function colorDot(color: string | null | undefined) {
  return color ? COLOR_DOT[color] ?? "var(--border)" : "var(--border)";
}

function colorLabelColor(color: string) {
  return COLOR_DOT[color] ?? undefined;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; color?: string }>;
}) {
  const session = await requireOnboardedSession("/notes");
  const { q, color } = await searchParams;

  const all = await listAllUserHighlights(session.user.id);

  const colorFilter = normalizeColorFilter(color);
  const query = q?.trim().toLowerCase() ?? "";
  const filtered = all.filter((highlight) =>
    highlightMatchesFilter(highlight, colorFilter, query),
  );
  const groups = groupHighlightsByArticle(filtered);

  const totalCount = all.length;
  const withNotes = all.filter((h) => h.note).length;

  return (
    <PageShell variant="listing">
      <PageHeader
        title="Notes & Highlights"
        description={`${totalCount} highlight${totalCount !== 1 ? "s" : ""} · ${withNotes} with notes`}
      />

      {/* ── Filters ── */}
      <form
        method="GET"
        className="flex flex-wrap items-center gap-[var(--space-3)] mb-[var(--space-6)]"
      >
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search highlights & notes…"
          aria-label="Search highlights and notes"
          className="flex-1 min-w-[160px]"
        />
        {/* Preserve existing color param when searching */}
        {colorFilter && <input type="hidden" name="color" value={colorFilter} />}

        <div className="flex items-center gap-[var(--space-2)]" role="group" aria-label="Filter by colour">
          <Link
            href="/notes"
            className={cn(
              "px-[var(--space-3)] py-[var(--space-1)] rounded-full text-[length:var(--text-sm)] border transition-colors",
              !colorFilter
                ? "bg-primary text-on-primary border-primary"
                : "border-border text-text-subtle hover:border-border-strong",
            )}
          >
            All
          </Link>
          {HIGHLIGHT_COLORS.map((c) => (
            <Link
              key={c}
              href={colorFilterHref(c, query)}
              aria-label={`Filter by ${c}`}
              className={cn(
                "w-6 h-6 rounded-full border-2 transition-all",
                colorFilter === c ? "border-[var(--text)] scale-110" : "border-border hover:border-border-strong",
              )}
              style={{ backgroundColor: COLOR_DOT[c] }}
            />
          ))}
        </div>
      </form>

      {groups.size === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No highlights yet"
          description={
            totalCount > 0
              ? "No highlights match your current filter."
              : "Select text in any article to create a highlight."
          }
          action={totalCount === 0 ? { label: "Browse articles", href: "/browse" } : undefined}
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-6)]">
          {[...groups.entries()].map(([articleId, { title, items }]) => (
            <section key={articleId} aria-labelledby={`article-${articleId}`}>
              {/* Article header */}
              <div
                className="flex items-start justify-between gap-[var(--space-3)] mb-[var(--space-3)]"
              >
                <h2
                  id={`article-${articleId}`}
                  className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-lg)] text-text leading-snug"
                >
                  {title}
                </h2>
                <ReferrerLink
                  href={`/reader/${articleId}`}
                  referrerLabel="Notes"
                  className="shrink-0 text-[length:var(--text-sm)] text-[var(--primary-text)] hover:underline flex items-center gap-[var(--space-1)]"
                >
                  <FileText size={14} aria-hidden />
                  Open article
                </ReferrerLink>
              </div>

              {/* Highlight cards */}
              <div className="flex flex-col gap-[var(--space-3)]">
                {items.map((h) => (
                  <Card key={h.id} className="p-[var(--space-4)]">
                    <div className="flex items-start gap-[var(--space-3)]">
                      {/* Colour swatch */}
                      <span
                        aria-label={h.color ?? "no colour"}
                        className="mt-1 shrink-0 rounded-sm"
                        style={{
                          width: 4,
                          minHeight: 40,
                          backgroundColor: colorDot(h.color),
                        }}
                      />

                      <div className="flex-1 min-w-0">
                        {/* Quoted text */}
                        <blockquote
                          className="text-[length:var(--text-base)] text-text leading-relaxed italic border-none m-0 p-0"
                          cite={`/reader/${articleId}`}
                        >
                          &ldquo;{h.quote}&rdquo;
                        </blockquote>

                        {/* Inline note editor (client) */}
                        <InlineNoteEditor highlightId={h.id} initialNote={h.note} />

                        {/* Meta row */}
                        <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
                          {formatShortDate(h.createdAt)}
                          {h.color && (
                            <span
                              className="ml-[var(--space-2)] capitalize"
                               style={{ color: colorLabelColor(h.color) }}
                            >
                              {h.color}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
