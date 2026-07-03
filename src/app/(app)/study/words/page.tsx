import { requireOnboardedSession } from "@/lib/session";
import { getFilteredSavedWords, getArticleTitlesForWords, WORDS_PAGE_SIZE } from "@/lib/lexical/saved-words";
import { articleAccessContext } from "@/lib/article-library";
import Link from "next/link";
import { PageHeader, PageShell, Toolbar, buttonVariants } from "@/components/ui";
import VocabularyExportButtons from "@/components/VocabularyExportButtons";
import VocabularyJournal from "@/components/VocabularyJournal";
import { ChevronLeft } from "lucide-react";

type SavedWordsFilter = "all" | "due" | "new";

interface SearchParams {
  q?: string;
  articleId?: string;
  filter?: string;
  page?: string;
}

function parseSavedWordsFilter(filter?: string): SavedWordsFilter {
  return filter === "due" || filter === "new" ? filter : "all";
}

function parsePageParam(page?: string): number {
  return Math.max(1, parseInt(page ?? "1", 10) || 1);
}

function uniqueArticleIds(
  words: Array<{ articleId?: string | null }>,
): string[] {
  return Array.from(
    new Set(words.flatMap(({ articleId }) => (articleId ? [articleId] : []))),
  );
}

export default async function StudyWordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOnboardedSession("/study/words");
  const context = articleAccessContext(session.user);
  const params = await searchParams;

  const query = params.q ?? "";
  const articleId = params.articleId ?? "";
  const filter = parseSavedWordsFilter(params.filter);
  const page = parsePageParam(params.page);

  const result = await getFilteredSavedWords(session.user.id, {
    search: query || undefined,
    articleId: articleId || undefined,
    filter,
    page,
  });

  const articleIds = uniqueArticleIds(result.words);
  const articles = await getArticleTitlesForWords(articleIds, context);

  const initial = {
    words: result.words.map((w) => ({
      ...w,
      createdAt: w.createdAt.toISOString(),
      dueAt: w.dueAt?.toISOString() ?? null,
    })),
    articles,
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
    pageSize: WORDS_PAGE_SIZE,
  };
  const backLinkClassName = [
    buttonVariants({ variant: "ghost", size: "sm" }),
    "mb-[var(--space-4)] inline-flex items-center gap-[var(--space-1)]",
  ].join(" ");

  return (
    <PageShell variant="listing">
      <Link
        href="/study"
        className={backLinkClassName}
      >
        <ChevronLeft size={16} aria-hidden />
        Back to Study hub
      </Link>

      <Toolbar className="mb-[var(--space-6)]">
        <PageHeader title="Vocabulary journal" className="mb-0" />
        <VocabularyExportButtons />
      </Toolbar>

      <VocabularyJournal
        initial={initial}
        initialQuery={query}
        initialArticleId={articleId}
        initialFilter={filter}
      />
    </PageShell>
  );
}
