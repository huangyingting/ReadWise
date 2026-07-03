import { Bookmark } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getUserLists, getListWithArticles } from "@/lib/article-library";
import { getProgressMap } from "@/lib/engagement";
import { getBookmarkedArticleIds } from "@/lib/article-library";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";
import ListSwitcher from "@/components/ListSwitcher";

const LIST_ARTICLE_GRID_CLASS =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-5)] rw-fade-up";

type UserList = Awaited<ReturnType<typeof getUserLists>>[number];
type ListArticle = NonNullable<
  Awaited<ReturnType<typeof getListWithArticles>>
>["articles"][number];

function getActiveList(
  lists: UserList[],
  requestedListId: string | undefined,
): UserList | null {
  const defaultList = lists.find((list) => list.isDefault);
  const requestedList = requestedListId
    ? lists.find((list) => list.id === requestedListId)
    : null;

  return requestedList ?? defaultList ?? lists[0] ?? null;
}

function toListSwitcherItems(lists: UserList[]) {
  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    isDefault: list.isDefault,
    count: list.count,
  }));
}

function getArticleProgress(
  article: ListArticle,
  progressMap: Awaited<ReturnType<typeof getProgressMap>>,
) {
  const progress = progressMap.get(article.id);
  return progress
    ? { percent: progress.percent, completed: progress.completed }
    : undefined;
}

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const session = await requireSession("/lists");
  const { list: listParam } = await searchParams;

  const lists = await getUserLists(session.user.id);

  // Determine the active list
  const activeList = getActiveList(lists, listParam);

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
          lists={toListSwitcherItems(lists)}
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
              <div className={LIST_ARTICLE_GRID_CLASS}>
                {listData.articles.map((article) => (
                  <ArticleCardView
                    key={article.id}
                    article={article}
                    progress={getArticleProgress(article, progressMap)}
                    saved={bookmarkedIds.has(article.id)}
                    // On the Saved page every card shows bookmark as "remove from list"
                    removeListId={activeList?.id}
                    removeListName={activeList?.name}
                  />
                ))}
              </div>

              <ListingSync articleIds={articleIds} />
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
