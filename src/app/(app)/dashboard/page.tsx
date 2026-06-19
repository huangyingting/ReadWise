import Image from "next/image";
import Link from "next/link";
import { BookOpen, SlidersHorizontal } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { listPublishedArticles, filterAndSortByLevel } from "@/lib/articles";
import { getProgressMap, listInProgressArticles } from "@/lib/progress";
import { ensureArticleDifficulties, DIFFICULTY_LEVELS, isDifficultyLevel } from "@/lib/difficulty";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { buttonVariants } from "@/components/ui/Button";
import ArticleCard from "@/components/ArticleCard";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import EmptyState from "@/components/EmptyState";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const session = await requireOnboardedSession("/dashboard");
  const user = session.user;

  const { level } = await searchParams;
  const activeLevel = isDifficultyLevel(level) ? level : null;

  const [articles, inProgressEntries] = await Promise.all([
    listPublishedArticles(),
    listInProgressArticles(user.id),
  ]);

  await ensureArticleDifficulties(articles);
  const visibleArticles = filterAndSortByLevel(articles, activeLevel);
  const progressMap = await getProgressMap(
    user.id,
    visibleArticles.map((a) => a.id),
  );

  // Union of rail + grid article ids for ListingProgressSync
  const railIds = inProgressEntries.map((e) => e.article.id);
  const gridIds = visibleArticles.map((a) => a.id);
  const allIds = [...new Set([...railIds, ...gridIds])];

  return (
    <main className="listing-container">
      {/* Identity card */}
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "1.5rem" }}
      >
        Dashboard
      </h1>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? "avatar"}
              width={56}
              height={56}
              className="rounded-full"
              unoptimized
            />
          ) : null}
          <div>
            <div className="font-semibold text-text">{user.name ?? "Unnamed reader"}</div>
            <div className="text-text-muted text-[length:var(--text-sm)]">{user.email}</div>
            <div className="text-text-muted text-[length:var(--text-sm)]">{user.role}</div>
          </div>
        </div>
      </Card>

      {/* Continue-reading rail — only when in-progress articles exist */}
      {inProgressEntries.length > 0 ? (
        <section style={{ marginTop: "var(--space-9)" }} aria-label="Continue reading">
          <div
            className="flex items-center justify-between mb-[var(--space-4)]"
          >
            <h2
              className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
            >
              Continue reading
            </h2>
            <span className="text-text-muted text-[length:var(--text-sm)]">
              {inProgressEntries.length} in progress
            </span>
          </div>
          <div
            tabIndex={0}
            className="flex gap-[var(--space-4)] overflow-x-auto pb-[var(--space-3)] -mx-[var(--space-1)] px-[var(--space-1)] snap-x snap-mandatory rw-rail-mask"
            style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
          >
            {inProgressEntries.map((entry) => (
              <ArticleCardView
                key={entry.article.id}
                article={entry.article}
                progress={entry.progress}
                variant="rail"
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Library grid */}
      <section style={{ marginTop: "var(--space-9)" }}>
        <div className="flex items-center justify-between mb-[var(--space-4)]">
          <h2
            className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          >
            Browse
          </h2>
          <Link
            href="/browse"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            By category
          </Link>
        </div>

        {/* Level filter */}
        <form
          method="get"
          className="flex flex-wrap gap-[var(--space-2)] items-center mb-[var(--space-5)]"
        >
          <label
            htmlFor="level"
            className="text-text-muted text-[length:var(--text-sm)]"
          >
            English level
          </label>
          <Select id="level" name="level" defaultValue={activeLevel ?? ""}>
            <option value="">All levels</option>
            {DIFFICULTY_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl} and below
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
          {activeLevel ? (
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Clear
            </Link>
          ) : null}
        </form>

        {/* Cards or empty state */}
        {visibleArticles.length === 0 ? (
          articles.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Nothing to read yet"
              description="Articles will appear here as they're added."
            />
          ) : (
            <EmptyState
              icon={SlidersHorizontal}
              title="No articles at this level"
              description="Try a higher CEFR level or clear the filter."
              action={{ label: "Clear filter", href: "/dashboard" }}
            />
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)] rw-fade-up">
            {visibleArticles.map((article) => {
              const progress = progressMap.get(article.id);
              return (
                <ArticleCard
                  key={article.id}
                  article={article}
                  progress={
                    progress
                      ? { percent: progress.percent, completed: progress.completed }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {/* Single ListingProgressSync over union of rail + grid ids (§4.3) */}
        <ListingProgressSync articleIds={allIds} />
      </section>
    </main>
  );
}
