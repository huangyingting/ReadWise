import type { Metadata } from "next";
import { requireOnboardedSession } from "@/lib/session";
import { listPersonalArticles, toListingArticle } from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ImportForm from "./ImportForm";

export const metadata: Metadata = {
  title: "Import Article — ReadWise",
};

export default async function ImportPage() {
  const session = await requireOnboardedSession("/import");
  const userId = session.user.id;

  const personalArticles = await listPersonalArticles(userId, 20);
  const progressMap =
    personalArticles.length > 0
      ? await getProgressSummaries(
          userId,
          personalArticles.map((a) => a.id),
        )
      : {};

  return (
    <div className="container max-w-[720px]">
      <h1 className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-2xl)] text-text mb-[var(--space-2)]">
        Import Article
      </h1>
      <p className="text-text-muted mb-[var(--space-6)]">
        Save any article for private reading. Paste a URL to scrape it, or paste
        the text directly. Imported articles are{" "}
        <strong>only visible to you</strong>.
      </p>

      <ImportForm />

      {personalArticles.length > 0 && (
        <section className="mt-[var(--space-7)]">
          <h2 className="font-semibold text-[length:var(--text-lg)] text-text mb-[var(--space-4)]">
            My Imports
          </h2>
          <div className="grid gap-[var(--space-4)]">
            {personalArticles.map((article) => (
              <ArticleCardView
                key={article.id}
                article={toListingArticle(article)}
                progress={progressMap[article.id]}
              />
            ))}
          </div>
          <ListingProgressSync articleIds={personalArticles.map((a) => a.id)} />
        </section>
      )}
    </div>
  );
}
