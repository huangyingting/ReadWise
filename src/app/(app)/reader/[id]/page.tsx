import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { safeJsonStringify } from "@/lib/safe-json";
import { requireSession } from "@/lib/session";
import { getArticleById, readingMinutesFor, listCategoryPage } from "@/lib/articles";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { getProgress, getProgressMap } from "@/lib/progress";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleTags, listRelatedArticles } from "@/lib/tags";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { SUPPORTED_LANGUAGES } from "@/lib/translation";
import { htmlToPlainText } from "@/lib/translation";
import { getArticleListMembership } from "@/lib/bookmarks";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics";
import { prisma } from "@/lib/prisma";
import { CEFR_LEVELS, type CefrLevel, CefrBadge, Badge } from "@/components/ui/Badge";
import ReaderProgress from "@/components/ReaderProgress";
import ArticleCard from "@/components/ArticleCard";
import ArticleHero from "@/components/ArticleHero";
import BilingualBody from "@/components/BilingualBody";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import ReaderControls from "@/components/ReaderControls";
import ArticleStudySection from "@/components/ArticleStudySection";
import ReaderLayout from "@/components/ReaderLayout";
import ReaderToolsSurface from "@/components/ReaderToolsSurface";
import { ReaderToolsProvider } from "@/components/ReaderToolsProvider";
import { ReaderAudioProvider } from "@/components/ReaderAudioProvider";
import { ReaderHighlightsProvider } from "@/components/ReaderHighlightsProvider";
import ReaderMiniPlayer from "@/components/ReaderMiniPlayer";
import ReaderBookmarkCluster from "@/components/ReaderBookmarkCluster";
import WordLookupHint from "@/components/WordLookupHint";
import ArticleDifficultyFeedback from "@/components/ArticleDifficultyFeedback";
import OfflineDownloadButton from "@/components/OfflineDownloadButton";
import ReaderReadingBlockTracker from "@/components/reader/ReaderReadingBlockTracker";
import ReaderTimeTracker from "@/components/reader/ReaderTimeTracker";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Use the published-only lookup — metadata should only expose published content.
  const article = await getArticleById(id);
  if (!article) {
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
  const context = articleAccessContext(session.user);

  const article = await getReadableArticleById(id, context);
  if (!article) {
    notFound();
  }

  // Product analytics (RW-051): record an article view. Best-effort + metadata
  // only (category/difficulty) — never the article text. Awaiting a single
  // insert that never throws keeps the page render reliable.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.articleView,
    userId: session.user.id,
    articleId: article.id,
    properties: { category: article.category, difficulty: article.difficulty },
  });

  // Parallel fetch: all five queries depend only on article.id / userId (independent of each other)
  const [progress, difficulty, tagsResult, relatedArticles, membership, existingFeedback] = await Promise.all([
    getProgress(session.user.id, article.id),
    getOrCreateArticleDifficulty(article.id, context),
    getOrCreateArticleTags(article.id, context),
    listRelatedArticles(article.id),
    // M10: SSR bookmark state for the reader cluster
    getArticleListMembership(session.user.id, article.id, session.user.role),
    // #124: existing difficulty vote for this user+article (may be null)
    prisma.articleDifficultyFeedback.findUnique({
      where: { userId_articleId: { userId: session.user.id, articleId: article.id } },
      select: { vote: true },
    }),
  ]);

  // If no related articles, fall back to articles from the same category.
  let keepReadingArticles = relatedArticles.slice(0, 3);
  if (keepReadingArticles.length === 0) {
    const fallbackPage = await listCategoryPage(article.category ?? null, { limit: 4 });
    keepReadingArticles = fallbackPage.articles
      .filter((a) => a.id !== article.id)
      .slice(0, 3);
  }

  // relatedProgress depends on keepReadingArticles — must come after
  const relatedProgress = await getProgressMap(
    session.user.id,
    keepReadingArticles.map((a) => a.id),
  );

  const difficultyLevel = (difficulty?.level ?? article.difficulty) as CefrLevel | null;
  const tags = tagsResult?.tags ?? [];
  const readingMinutes = readingMinutesFor(article);
  const cleanBody = sanitizeArticleHtml(article.content);
  const articlePlainText = htmlToPlainText(article.content);

  const isBookmarked = membership?.find((l) => l.isDefault)?.hasArticle ?? false;
  const isCompleted = progress?.completed ?? false;
  const userDifficultyVote = existingFeedback?.vote as "too_easy" | "just_right" | "too_hard" | null ?? null;

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
        dangerouslySetInnerHTML={{ __html: safeJsonStringify(jsonLd) }}
      />
      {/* Reading progress — fixed top bar, z-50, forward-only. Lives OUTSIDE the
          client providers so it does NOT create an extra Suspense boundary that
          could conflict with the route-segment loading.tsx skeleton. */}
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
  var font=prefs&&prefs.fontFamily?prefs.fontFamily:'serif';
  el.dataset.readingFont=font;
  var spacing=prefs&&prefs.lineSpacing?prefs.lineSpacing:'normal';
  el.dataset.readingSpacing=spacing;
}catch(e){}})();
            `.trim(),
          }}
        />
        {/*
         * Scope the "use client" providers INSIDE #reader-root so they don't
         * wrap the entire RSC page output. Having client components at the very
         * top of the RSC tree creates a second Suspense boundary that races with
         * the route-segment Suspense (loading.tsx), leaving the streaming
         * container (#S:N) visible and duplicating the DOM (#48).
         */}
        <ReaderAudioProvider>
        <ReaderHighlightsProvider articleId={article.id}>
          <ReaderToolsProvider>
          <ReaderLayout>
            {/* ---- Reading column ---- */}
            <div className="reader-column">
              {/* Reader-local skip link: lets keyboard users jump past the sticky
                  controls directly to the article (WCAG 2.4.1, #65).
                  Sits before ReaderControls so Tab from global skip target reaches
                  it first. */}
              <a href="#reader-article" className="skip-link">
                Skip to article
              </a>

              {/* Slim sticky toolbar: Back · Listen · Aa (display settings) · Tools */}
              <ReaderControls articleId={article.id} />

              <article
                id="reader-article"
                tabIndex={-1}
                aria-labelledby="article-title"
              >
                {/* Article header */}
                <header className="reader-article-header">
                  <h1 id="article-title" className="reader-article-title">{article.title}</h1>

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
                        title="AI-estimated reading level"
                      />
                    ) : difficultyLevel ? (
                      <Badge variant="neutral" title="AI-estimated reading level">
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

                    {/* #117 offline download button */}
                    <OfflineDownloadButton articleId={article.id} />
                  </div>

                  {/* Tags */}
                  {tags.length > 0 ? (
                    <div className="reader-tags" aria-label="Article tags">
                      {tags.map((tag) =>
                        tag.scope === "PUBLIC" ? (
                          <Link
                            key={tag.id}
                            href={`/tags/${tag.slug}`}
                            className="tag-chip"
                          >
                            #{tag.name}
                          </Link>
                        ) : (
                          <span key={tag.id} className="tag-chip">
                            #{tag.name}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                </header>

                {/* Hero image — graceful 16:9 frame that collapses on error */}
                <ArticleHero src={article.heroImage} alt={article.title} />

                {/* Word-lookup / highlight hint — dismissible (localStorage) */}
                <WordLookupHint />

                {/* Prose — bilingual-capable wrapper (falls back to normal WordLookup when disabled) */}
                <BilingualBody html={cleanBody} articleId={article.id} languages={SUPPORTED_LANGUAGES} />
              </article>

              {/* #376 — Observe the prose to track current reading block.
                  #378 — Track active reading time for WPM analytics.
                  Both render null and must be inside ReaderToolsProvider. */}
              <ReaderReadingBlockTracker />
              <ReaderTimeTracker articleId={article.id} />

              {/* Difficulty feedback widget (#124) */}
              <ArticleDifficultyFeedback
                articleId={article.id}
                initialVote={userDifficultyVote}
                difficulty={difficultyLevel}
              />

              {/* Read-after practice & study tools — in-flow SSR anchor/CTA
                  that opens the responsive Tools surface (#153). */}
              <ArticleStudySection />

              {/* Keep reading — CTA section after the article body (#110) */}
              {keepReadingArticles.length > 0 ? (
                <section className="reader-related" aria-label="Keep reading">
                  {/* Completion banner */}
                  {isCompleted ? (
                    <div
                      className="reader-completion-banner"
                      role="status"
                    >
                      <span aria-hidden="true">✓</span>
                      <span>Article completed! Here&rsquo;s what to read next.</span>
                    </div>
                  ) : null}
                  <h2
                    className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)] mt-0"
                  >
                    Keep reading
                  </h2>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {relatedArticles.length > 0
                      ? "Other articles that share tags with this one."
                      : "More articles from the same category."}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)]">
                    {keepReadingArticles.map((related) => {
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
                  <ListingProgressSync
                    articleIds={keepReadingArticles.map((a) => a.id)}
                  />
                  <ListingBookmarkSync articleIds={keepReadingArticles.map((a) => a.id)} />
                </section>
              ) : null}
            </div>

            {/* ---- Tools surface ---- second grid column on xl (sticky rail),
                 a focus-trapped bottom sheet on <xl. Single mounted instance. */}
            <ReaderToolsSurface
              articleId={article.id}
              plainText={articlePlainText}
            />
          </ReaderLayout>
          </ReaderToolsProvider>

          {/* Fixed bottom audio mini-player (appears after first narration load) */}
          <ReaderMiniPlayer />
        </ReaderHighlightsProvider>
        </ReaderAudioProvider>
      </div>
    </>
  );
}
