import { Bookmark } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getUserLists, getListWithArticles } from "@/lib/bookmarks";
import { getProgressMap } from "@/lib/progress";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";
import EmptyState from "@/components/EmptyState";
import ListSwitcher from "@/components/ListSwitcher";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const session = await requireSession("/lists");
  const { list: listParam } = await searchParams;

  const lists = await getUserLists(session.user.id);

  // Determine the active list
  const defaultList = lists.find((l) => l.isDefault);
  const requestedList = listParam ? lists.find((l) => l.id === listParam) : null;
  const activeList = requestedList ?? defaultList ?? lists[0] ?? null;

  // Fetch articles for the active list
  const listData = activeList
    ? await getListWithArticles(activeList.id, session.user.id)
    : null;

  const articleIds = listData?.articles.map((a) => a.id) ?? [];
  const [progressMap, bookmarkedIds] = await Promise.all([
    getProgressMap(session.user.id, articleIds),
    getBookmarkedArticleIds(session.user.id, articleIds),
  ]);

  const isDefaultList = activeList?.isDefault ?? true;

  return (
    <PageShell variant="listing">
      {/* Page header */}
      <PageHeader title="Saved" />

      {/* Two-region layout: sidebar switcher + article grid */}
      <div className="lists-layout">
        {/* List switcher: desktop sidebar / mobile pill bar */}
        <ListSwitcher
          lists={lists.map((l) => ({
            id: l.id,
            name: l.name,
            isDefault: l.isDefault,
            count: l.count,
          }))}
          activeListId={activeList?.id ?? null}
        />

        {/* Article grid */}
        <div
          role="tabpanel"
          aria-label={activeList?.name ?? "Saved"}
          className="min-w-0"
        >
          {/* Per-list heading — only shown for non-default lists to avoid
              duplicating the "Saved" page H1 that PageHeader already renders. */}
          {!isDefaultList && (
            <div className="lists-panel-header">
              <h2
                className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mt-0 mb-[var(--space-4)]"
              >
                {activeList?.name ?? "Saved"}
              </h2>
            </div>
          )}

          {!listData || listData.articles.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title={
                isDefaultList ? "No saved articles yet" : "This list is empty"
              }
              description="Tap the bookmark on any article to add it here."
              action={{ label: "Browse articles", href: "/browse" }}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-5)] rw-fade-up">
                {listData.articles.map((article) => {
                  const progress = progressMap.get(article.id);
                  return (
                    <ArticleCardView
                      key={article.id}
                      article={article}
                      progress={
                        progress
                          ? { percent: progress.percent, completed: progress.completed }
                          : undefined
                      }
                      saved={bookmarkedIds.has(article.id)}
                      // On the Saved page every card shows bookmark as "remove from list"
                      removeListId={activeList?.id}
                      removeListName={activeList?.name}
                    />
                  );
                })}
              </div>

              <ListingSync articleIds={articleIds} />
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
