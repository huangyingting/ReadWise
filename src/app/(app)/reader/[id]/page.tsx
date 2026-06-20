import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getArticleById, getViewableArticleById, readingMinutesFor } from "@/lib/articles";
import { getProgress, getProgressMap } from "@/lib/progress";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleTags, listRelatedArticles } from "@/lib/tags";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { SUPPORTED_LANGUAGES } from "@/lib/translation";
import { htmlToPlainText } from "@/lib/translation";
import { getArticleListMembership } from "@/lib/bookmarks";
import { CEFR_LEVELS, type CefrLevel, CefrBadge, Badge } from "@/components/ui/Badge";
import ReaderProgress from "@/components/ReaderProgress";
import ArticleCard from "@/components/ArticleCard";
import WordLookup from "@/components/WordLookup";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import ReaderControls from "@/components/ReaderControls";
import ReaderToolsPanel from "@/components/ReaderToolsPanel";
import { ReaderAudioProvider } from "@/components/ReaderAudioProvider";
import { ReaderHighlightsProvider } from "@/components/ReaderHighlightsProvider";
import ReaderMiniPlayer from "@/components/ReaderMiniPlayer";
import ReaderBookmarkCluster from "@/components/ReaderBookmarkCluster";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Use the published-only lookup — metadata should only expose published content.
  const article = await getArticleById(id);
  if (!article || article.status !== "published") {
    return { title: "Article" };
  }

  const description = htmlToPlainText(article.content)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);

  return {
    title: article.title,
    description,
    openGraph: {
      type: "article",
      title: article.title,
      description,
      ...(article.author ? { authors: [article.author] } : {}),
      ...(article.publishedAt
        ? { publishedTime: new Date(article.publishedAt).toISOString() }
        : {}),
      ...(article.heroImage ? { images: [article.heroImage] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
      ...(article.heroImage ? { images: [article.heroImage] } : {}),
    },
  };
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession(`/reader/${id}`);

  const article = await getViewableArticleById(id, session.user.role);
  if (!article) {
    notFound();
  }

  // Parallel fetch: all five queries depend only on article.id / userId (independent of each other)
  const [progress, difficulty, tagsResult, relatedArticles, membership] = await Promise.all([
    getProgress(session.user.id, article.id),
    getOrCreateArticleDifficulty(article.id),
    getOrCreateArticleTags(article.id),
    listRelatedArticles(article.id),
    // M10: SSR bookmark state for the reader cluster
    getArticleListMembership(session.user.id, article.id),
  ]);

  // relatedProgress depends on relatedArticles — must come after
  const relatedProgress = await getProgressMap(
    session.user.id,
    relatedArticles.map((a) => a.id),
  );

  const difficultyLevel = (difficulty?.level ?? article.difficulty) as CefrLevel | null;
  const tags = tagsResult?.tags ?? [];
  const readingMinutes = readingMinutesFor(article);
  const cleanBody = sanitizeArticleHtml(article.content);
  const articlePlainText = htmlToPlainText(article.content);

  const isBookmarked = membership?.find((l) => l.isDefault)?.hasArticle ?? false;

  const isValidCefrLevel = difficultyLevel && (CEFR_LEVELS as readonly string[]).includes(difficultyLevel);

  // JSON-LD structured data for schema.org NewsArticle.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: articlePlainText.trim().replace(/\s+/g, " ").slice(0, 200),
    ...(article.author
      ? { author: { "@type": "Person", name: article.author } }
      : {}),
    publisher: {
      "@type": "Organization",
      name: article.source ?? "ReadWise",
    },
    ...(article.publishedAt
      ? { datePublished: new Date(article.publishedAt).toISOString() }
      : {}),
    ...(article.heroImage ? { image: article.heroImage } : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ReaderAudioProvider>
      <ReaderHighlightsProvider articleId={article.id}>
        {/*
         * No-flash inline script: reads localStorage["readwise:reader-prefs"]
         * and sets data-reading-mode + --reading-font-scale on #reader-root
         * BEFORE first paint. Mirrors the global theme script in layout.tsx.
         * suppressHydrationWarning on the root div avoids React mismatch warning
         * (the script mutates the element pre-hydration).
         */}
        {/* Reading progress — fixed top bar, z-50, forward-only (unchanged) */}
        <ReaderProgress
          articleId={article.id}
          initialPercent={progress?.percent ?? 0}
        />

        <div
          id="reader-root"
          suppressHydrationWarning
        >
          {/*
           * No-flash inline script: MUST be the first child of #reader-root so
           * that document.currentScript.parentElement resolves to the element
           * BEFORE any of its children are painted. Using getElementById fails
           * because the script executes before #reader-root finishes parsing.
           * suppressHydrationWarning on the parent prevents React from warning
           * about the pre-hydration attribute mutation.
           */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
(function(){try{
  var raw=localStorage.getItem('readwise:reader-prefs');
  var prefs=raw?JSON.parse(raw):null;
  var el=document.currentScript&&document.currentScript.parentElement;
  if(!el)return;
  var mode=prefs&&prefs.mode?prefs.mode:(
    document.documentElement.dataset.theme==='dark'?'dark':'light'
  );
  el.dataset.readingMode=mode;
  var scale=prefs&&typeof prefs.fontScale==='number'?prefs.fontScale:1;
  el.style.setProperty('--reading-font-scale',String(scale));
}catch(e){}})();
              `.trim(),
            }}
          />
          <main id="main-content" className="reader-layout">
            {/* ---- Reading column ---- */}
            <div className="reader-column">
              {/* Sticky controls: Aa−/Aa+ stepper + Light/Sepia/Dark mode */}
              <ReaderControls />

              <article>
                {/* Article header */}
                <header className="reader-article-header">
                  <h1 className="reader-article-title">{article.title}</h1>

                  {/* Byline / source */}
                  {(article.author || article.source) ? (
                    <p className="reader-byline">
                      {article.author ? article.author : null}
                      {article.author && article.source ? " · " : null}
                      {article.source && article.sourceUrl ? (
                        <a
                          href={article.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          {article.source}
                        </a>
                      ) : article.source ? (
                        article.source
                      ) : null}
                    </p>
                  ) : null}

                  {/* Meta row: CEFR badge · reading time · completed · bookmark */}
                  <div className="reader-meta">
                    {isValidCefrLevel ? (
                      <CefrBadge
                        level={difficultyLevel as CefrLevel}
                        title="Assessed English level"
                      />
                    ) : difficultyLevel ? (
                      <Badge variant="neutral" title="Assessed English level">
                        Level {difficultyLevel}
                      </Badge>
                    ) : null}

                    {readingMinutes != null ? (
                      <Badge variant="neutral">⏱ {readingMinutes} min read</Badge>
                    ) : null}

                    {progress?.completed ? (
                      <Badge variant="success">✓ Completed</Badge>
                    ) : null}

                    {/* M10 bookmark split-pill (segment A toggle + segment B list picker) */}
                    <ReaderBookmarkCluster
                      articleId={article.id}
                      initialSaved={isBookmarked}
                    />
                  </div>

                  {/* Tags */}
                  {tags.length > 0 ? (
                    <div className="reader-tags" aria-label="Article tags">
                      {tags.map((tag) => (
                        <Link
                          key={tag.id}
                          href={`/tags/${tag.slug}`}
                          className="tag-chip"
                        >
                          #{tag.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </header>

                {/* Hero image — slight bleed (wider than 66ch) */}
                {article.heroImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="article-hero"
                    src={article.heroImage}
                    alt={article.title}
                  />
                ) : null}

                {/* Word-lookup / highlight hint (updated for M11) */}
                <p className="muted word-lookup-hint">
                  Click a word to define it · Select text to highlight or add a note · Use{" "}
                  <kbd style={{ fontFamily: "inherit", fontSize: "0.9em" }}>⌘/Ctrl+E</kbd> with a selection
                </p>

                {/* Prose — ONLY renderer of sanitized HTML (unchanged constraint) */}
                <WordLookup html={cleanBody} articleId={article.id} languages={SUPPORTED_LANGUAGES} />
              </article>

              {/* Related articles (M4 grid — unchanged) */}
              {relatedArticles.length > 0 ? (
                <section className="reader-related" aria-label="Related articles">
                  <h2
                    className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)] mt-0"
                  >
                    Related articles
                  </h2>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Other articles that share tags with this one.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)]">
                    {relatedArticles.map((related) => {
                      const rel = relatedProgress.get(related.id);
                      return (
                        <ArticleCard
                          key={related.id}
                          article={related}
                          progress={
                            rel
                              ? { percent: rel.percent, completed: rel.completed }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                  <ListingProgressSync articleIds={relatedArticles.map((a) => a.id)} />
                  <ListingBookmarkSync articleIds={relatedArticles.map((a) => a.id)} />
                </section>
              ) : null}
            </div>

            {/* ---- Tools rail (desktop) / FAB+bottom-sheet (mobile) ---- */}
            <ReaderToolsPanel
              articleId={article.id}
              languages={SUPPORTED_LANGUAGES}
              plainText={articlePlainText}
            />
          </main>

          {/* Fixed bottom audio mini-player (appears after first narration load) */}
          <ReaderMiniPlayer />
        </div>
      </ReaderHighlightsProvider>
    </ReaderAudioProvider>
    </>
  );
}

