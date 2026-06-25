import type { Metadata } from "next";
import { requireOnboardedSession } from "@/lib/session";
import {
  listPersonalArticlesPage,
  toListingArticle,
  IMPORTS_PAGE_SIZE,
} from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";
import ImportForm from "./ImportForm";
import PersonalImports from "./PersonalImports";
import { importPage } from "@/lib/copy/pages";

export const metadata: Metadata = importPage;

export default async function ImportPage() {
  const session = await requireOnboardedSession("/import");
  const userId = session.user.id;

  const { articles: personalArticles, hasMore } = await listPersonalArticlesPage(
    userId,
    { offset: 0, limit: IMPORTS_PAGE_SIZE },
  );
  const progressMap =
    personalArticles.length > 0
      ? await getProgressSummaries(
          userId,
          personalArticles.map((a) => a.id),
        )
      : {};

  return (
    <PageShell variant="narrow">
      <PageHeader
        title="Import Article"
        description="Save any article for private reading. Paste a URL to scrape it, or paste the text directly. Imported articles are only visible to you."
      />

      <ImportForm />

      <PersonalImports
        initialArticles={personalArticles.map(toListingArticle)}
        initialProgress={progressMap}
        initialHasMore={hasMore}
        initialOffset={personalArticles.length}
      />
    </PageShell>
  );
}
