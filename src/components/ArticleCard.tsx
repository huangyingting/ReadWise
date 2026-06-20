import type { Article } from "@prisma/client";
import { toListingArticle } from "@/lib/articles";
import ArticleCardView, { type ArticleCardProgress } from "@/components/ArticleCardView";

export type { ArticleCardProgress };

export default function ArticleCard({
  article,
  progress,
  saved,
}: {
  article: Article;
  progress?: ArticleCardProgress;
  saved?: boolean;
}) {
  return <ArticleCardView article={toListingArticle(article)} progress={progress} saved={saved} />;
}
