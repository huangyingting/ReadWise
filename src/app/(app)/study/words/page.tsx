import { requireOnboardedSession } from "@/lib/session";
import { getFilteredSavedWords, WORDS_PAGE_SIZE } from "@/lib/vocabulary";
import { prisma } from "@/lib/prisma";
import { articleAccessContext, readableArticleWhere } from "@/lib/article-access";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import VocabularyExportButtons from "@/components/VocabularyExportButtons";
import VocabularyJournal from "@/components/VocabularyJournal";
import { ChevronLeft } from "lucide-react";

interface SearchParams {
  q?: string;
  articleId?: string;
  filter?: string;
  page?: string;
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
  const rawFilter = params.filter ?? "all";
  const filter: "all" | "due" | "new" =
    rawFilter === "due" || rawFilter === "new" ? rawFilter : "all";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const result = await getFilteredSavedWords(session.user.id, {
    search: query || undefined,
    articleId: articleId || undefined,
    filter,
    page,
  });

  // Resolve article titles for all words that have an articleId
  const articleIds = [
    ...new Set(result.words.map((w) => w.articleId).filter(Boolean) as string[]),
  ];

  const articles: Record<string, string> = {};
  if (articleIds.length > 0) {
    const rows = await prisma.article.findMany({
      where: readableArticleWhere(context, { id: { in: articleIds } }),
      select: { id: true, title: true },
    });
    for (const row of rows) {
      articles[row.id] = row.title;
    }
  }

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

  return (
    <div className="listing-container">
      {/* Back link */}
      <Link
        href="/study"
        className={buttonVariants({ variant: "ghost", size: "sm" }) + " mb-[var(--space-4)] inline-flex items-center gap-[var(--space-1)]"}
      >
        <ChevronLeft size={16} aria-hidden />
        Back to Study hub
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-[var(--space-3)] mb-[var(--space-6)]">
        <h1 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text m-0">
          Vocabulary journal
        </h1>
        <VocabularyExportButtons />
      </div>

      <VocabularyJournal
        initial={initial}
        initialQuery={query}
        initialArticleId={articleId}
        initialFilter={filter}
      />
    </div>
  );
}
