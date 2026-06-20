import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getArticleById, readingMinutesFor } from "@/lib/articles";
import { getProgress, getProgressMap } from "@/lib/progress";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleTags, listRelatedArticles } from "@/lib/tags";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { SUPPORTED_LANGUAGES } from "@/lib/translation";
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
import ReaderMiniPlayer from "@/components/ReaderMiniPlayer";
import ReaderBookmarkCluster from "@/components/ReaderBookmarkCluster";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession(`/reader/${id}`);

  const article = await getArticleById(id);
  if (!article) {
    notFound();
  }

  const progress = await getProgress(session.user.id, article.id);
  const difficulty = await getOrCreateArticleDifficulty(article.id);
  const difficultyLevel = (difficulty?.level ?? article.difficulty) as CefrLevel | null;
  const tags = (await getOrCreateArticleTags(article.id))?.tags ?? [];
  const relatedArticles = await listRelatedArticles(article.id);
  const relatedProgress = await getProgressMap(
    session.user.id,
    relatedArticles.map((a) => a.id),
  );
  const readingMinutes = readingMinutesFor(article);
  const cleanBody = sanitizeArticleHtml(article.content);

  // M10: SSR bookmark state for the reader cluster
  const membership = await getArticleListMembership(session.user.id, article.id);
  const isBookmarked = membership?.find((l) => l.isDefault)?.hasArticle ?? false;

  const isValidCefrLevel = difficultyLevel && (CEFR_LEVELS as readonly string[]).includes(difficultyLevel);

  return (
    <ReaderAudioProvider>
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

              {/* Word-lookup hint */}
              <p className="muted word-lookup-hint">
                Tip: click or select any word to look up its meaning.
              </p>

              {/* Prose — ONLY renderer of sanitized HTML (unchanged constraint) */}
              <WordLookup html={cleanBody} />
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
          />
        </main>

        {/* Fixed bottom audio mini-player (appears after first narration load) */}
        <ReaderMiniPlayer />
      </div>
    </ReaderAudioProvider>
  );
}

