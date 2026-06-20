import Link from "next/link";
import { BookmarkCheck, FileText, StickyNote } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { listAllUserHighlights, HIGHLIGHT_COLORS } from "@/lib/highlights";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/EmptyState";

export const metadata = { title: "Notes & Highlights — ReadWise" };

// Map colour label → CSS custom-highlight colour token (graceful fallback)
const COLOR_DOT: Record<string, string> = {
  yellow: "#fbbf24",
  green: "#34d399",
  blue: "#60a5fa",
  pink: "#f472b6",
};

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; color?: string }>;
}) {
  const session = await requireOnboardedSession("/notes");
  const { q, color } = await searchParams;

  const all = await listAllUserHighlights(session.user.id);

  // Filter
  const colorFilter = color && (HIGHLIGHT_COLORS as readonly string[]).includes(color) ? color : null;
  const query = q?.trim().toLowerCase() ?? "";

  const filtered = all.filter((h) => {
    if (colorFilter && h.color !== colorFilter) return false;
    if (query) {
      const haystack = `${h.quote} ${h.note ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  // Group by article (preserving title-asc order from the query)
  const groups = new Map<string, { title: string; items: typeof filtered }>();
  for (const h of filtered) {
    const key = h.article.id;
    if (!groups.has(key)) groups.set(key, { title: h.article.title, items: [] });
    groups.get(key)!.items.push(h);
  }

  const totalCount = all.length;
  const withNotes = all.filter((h) => h.note).length;

  return (
    <main className="listing-container">
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "var(--space-2)" }}
      >
        Notes &amp; Highlights
      </h1>
      <p className="text-text-subtle text-[length:var(--text-sm)]" style={{ marginBottom: "var(--space-6)" }}>
        {totalCount} highlight{totalCount !== 1 ? "s" : ""} · {withNotes} with notes
      </p>

      {/* ── Filters ── */}
      <form
        method="GET"
        className="flex flex-wrap items-center gap-[var(--space-3)]"
        style={{ marginBottom: "var(--space-6)" }}
      >
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search highlights & notes…"
          aria-label="Search highlights and notes"
          className="flex-1 min-w-[160px] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] border border-border bg-surface text-text text-[length:var(--text-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
        {/* Preserve existing color param when searching */}
        {colorFilter && <input type="hidden" name="color" value={colorFilter} />}

        <div className="flex items-center gap-[var(--space-2)]" role="group" aria-label="Filter by colour">
          <Link
            href="/notes"
            className={`px-[var(--space-3)] py-[var(--space-1)] rounded-full text-[length:var(--text-sm)] border transition-colors ${
              !colorFilter
                ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                : "border-border text-text-subtle hover:border-border-strong"
            }`}
          >
            All
          </Link>
          {HIGHLIGHT_COLORS.map((c) => (
            <Link
              key={c}
              href={`/notes?color=${c}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
              aria-label={`Filter by ${c}`}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
                colorFilter === c ? "border-[var(--text)] scale-110" : "border-border hover:border-border-strong"
              }`}
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
                className="flex items-start justify-between gap-[var(--space-3)]"
                style={{ marginBottom: "var(--space-3)" }}
              >
                <h2
                  id={`article-${articleId}`}
                  className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-lg)] text-text leading-snug"
                >
                  {title}
                </h2>
                <Link
                  href={`/reader/${articleId}`}
                  className="shrink-0 text-[length:var(--text-sm)] text-[var(--primary-text)] hover:underline flex items-center gap-[var(--space-1)]"
                >
                  <FileText size={14} aria-hidden />
                  Open article
                </Link>
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
                          backgroundColor: h.color ? COLOR_DOT[h.color] ?? "var(--border)" : "var(--border)",
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

                        {/* Note */}
                        {h.note && (
                          <p
                            className="mt-[var(--space-2)] text-[length:var(--text-sm)] text-text-muted"
                            style={{ whiteSpace: "pre-wrap" }}
                          >
                            <BookmarkCheck
                              size={13}
                              className="inline mr-1 text-[var(--teal)]"
                              aria-hidden
                            />
                            {h.note}
                          </p>
                        )}

                        {/* Meta row */}
                        <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
                          {new Date(h.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                          {h.color && (
                            <span
                              className="ml-[var(--space-2)] capitalize"
                              style={{ color: COLOR_DOT[h.color] ?? undefined }}
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
    </main>
  );
}
