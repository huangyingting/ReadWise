import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES, hasCapability } from "@/lib/rbac";
import { getAdminArticleDetail } from "@/lib/article-library";
import { statusBadgeVariant } from "@/lib/admin";
import { readingMinutesFor } from "@/lib/article-library";
import { sanitizeArticleHtml } from "@/lib/content-pipeline";
import { articleAccessContext } from "@/lib/article-library";
import {
  listContentReviews,
  REVIEW_STATES,
  REVIEW_STATE_LABELS,
  QUALITY_FLAGS,
  parseQualityFlags,
  type ReviewState,
} from "@/lib/article-library";
import { TAKEDOWN_STATES, TAKEDOWN_STATE_LABELS, type TakedownState } from "@/lib/article-library";
import { getArticleTags } from "@/lib/article-library";
import AdminArticleActions from "@/components/AdminArticleActions";
import AdminArticleReview from "@/components/AdminArticleReview";
import AdminArticleTakedown from "@/components/AdminArticleTakedown";
import { Card, CardMeta, CardTitle } from "@/components/ui/Card";
import { Badge, CefrBadge, CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/display-format";

/** Maps a processing-step status to a Badge variant. */
function stepStatusVariant(
  status: string,
): "success" | "neutral" | "warning" | "danger" {
  if (status === "generated") return "success";
  if (status === "fallback") return "warning";
  if (status === "failed") return "danger";
  if (status === "running") return "warning";
  return "neutral";
}

export default async function AdminArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireCapability(CAPABILITIES.articlesManage, `/admin/articles/${id}`);

  const detail = await getAdminArticleDetail(id, articleAccessContext(session.user));
  if (!detail) {
    notFound();
  }

  const { article, counts, difficultyFeedback, processingSteps } = detail;
  const minutes = readingMinutesFor(article);

  const canModerate = hasCapability(session.user, CAPABILITIES.contentModerate);
  const [reviews, articleTags] = canModerate
    ? await Promise.all([listContentReviews(article.id), getArticleTags(article.id)])
    : [[], []];
  const currentFlags = parseQualityFlags(article.qualityFlags);

  const aiItems: { label: string; value: number }[] = [
    { label: "Translations", value: counts.translations },
    { label: "Vocabulary", value: counts.vocabulary },
    { label: "Quiz questions", value: counts.quizQuestions },
    { label: "Tags", value: counts.tags },
    { label: "Narration", value: counts.speech },
    { label: "Reads tracked", value: counts.readingProgress },
  ];

  return (
    <section className="stack">
      <Link href="/admin/articles" className="muted">
        ← Back to articles
      </Link>

      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        {article.title}
      </h1>
      <div className="article-meta muted">
        <Badge variant={statusBadgeVariant(article.status)}>
          {article.status}
        </Badge>
        {article.reviewState && article.reviewState !== "unreviewed" && (
          <Badge
            variant={
              article.reviewState === "approved"
                ? "success"
                : article.reviewState === "rejected"
                  ? "danger"
                  : "warning"
            }
          >
            {REVIEW_STATE_LABELS[article.reviewState as ReviewState] ?? article.reviewState}
          </Badge>
        )}
        {article.takedownState && article.takedownState !== "active" && (
          <Badge variant="danger">
            {TAKEDOWN_STATE_LABELS[article.takedownState as TakedownState] ??
              article.takedownState}
          </Badge>
        )}
        {article.difficulty &&
          (CEFR_LEVELS as readonly string[]).includes(article.difficulty) ? (
            <CefrBadge level={article.difficulty as CefrLevel} />
          ) : (
            article.difficulty && (
              <Badge variant="neutral">Level {article.difficulty}</Badge>
            )
          )}
        {article.category && (
          <Badge variant="neutral">{article.category}</Badge>
        )}
        {minutes != null && <span>{minutes} min read</span>}
        {article.author && <span>By {article.author}</span>}
        {article.source && <span>{article.source}</span>}
      </div>

      {article.sourceUrl && (
        <p className="muted" style={{ margin: 0 }}>
          Source:{" "}
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
            {article.sourceUrl}
          </a>
        </p>
      )}

      <Card>
        <div className="stack">
          <CardTitle level="h3">Derived content</CardTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
            {aiItems.map((item) => (
              <Card key={item.label} className="p-[var(--space-4)]">
                <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
                  {item.value}
                </div>
                <CardMeta>{item.label}</CardMeta>
              </Card>
            ))}
          </div>
          <AdminArticleActions articleId={article.id} redirectOnDelete="/admin/articles" />
        </div>
      </Card>

      {canModerate && (
        <Card>
          <div className="stack">
            <CardTitle level="h3">Moderation &amp; review</CardTitle>
            <p className="muted" style={{ margin: 0 }}>
              Correct metadata, set the review verdict, and adjust quality flags.
              Every save is recorded in the review history below.
            </p>
            <AdminArticleReview
              articleId={article.id}
              reviewStateOptions={REVIEW_STATES.map((s) => ({
                value: s,
                label: REVIEW_STATE_LABELS[s],
              }))}
              qualityFlagOptions={[...QUALITY_FLAGS]}
              initial={{
                title: article.title,
                excerpt: article.excerpt ?? "",
                category: article.category ?? "",
                difficulty: article.difficulty ?? "",
                status: article.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
                reviewState: article.reviewState ?? "unreviewed",
                qualityFlags: currentFlags,
                tags: articleTags.map((t) => t.name).join(", "),
              }}
            />
          </div>
        </Card>
      )}

      {canModerate && (
        <Card>
          <div className="stack">
            <CardTitle level="h3">Rights &amp; takedown</CardTitle>
            <p className="muted" style={{ margin: 0 }}>
              Track content rights and respond to takedown requests. Unpublishing,
              archiving or taking down moves the article out of public feeds.
            </p>
            {article.canonicalUrl && (
              <p className="muted" style={{ margin: 0 }}>
                Canonical:{" "}
                <a href={article.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow">
                  {article.canonicalUrl}
                </a>
              </p>
            )}
            <AdminArticleTakedown
              articleId={article.id}
              currentState={article.takedownState ?? "active"}
              stateOptions={TAKEDOWN_STATES.map((s) => ({
                value: s,
                label: TAKEDOWN_STATE_LABELS[s],
              }))}
              currentRightsNote={article.rightsNote ?? ""}
            />
          </div>
        </Card>
      )}

      {canModerate && reviews.length > 0 && (
        <Card>
          <div className="stack">
            <CardTitle level="h3">Review history</CardTitle>
            <div
              className="admin-table-wrap"
              tabIndex={0}
              aria-label="Review history table (scrollable)"
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Changes</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td className="muted">{formatDateTime(r.createdAt)}</td>
                      <td className="font-medium">{r.action}</td>
                      <td className="muted text-[length:var(--text-sm)]">
                        {Object.keys((r.changes as Record<string, unknown>) ?? {}).join(", ") ||
                          "—"}
                      </td>
                      <td className="muted text-[length:var(--text-sm)]">{r.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="stack">
          <CardTitle level="h3">Processing state</CardTitle>
          <p className="muted" style={{ margin: 0 }}>
            Step-level enrichment timeline. Failed steps show the last error so
            you can see exactly why an article is not fully enriched.
          </p>
          {processingSteps.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No processing steps recorded yet. They are written the next time
              this article is processed.
            </p>
          ) : (
            <div
              className="admin-table-wrap"
              tabIndex={0}
              aria-label="Processing steps table (scrollable)"
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Model</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {processingSteps.map((step) => (
                    <tr key={step.id}>
                      <td className="font-medium">{step.step}</td>
                      <td>
                        <Badge variant={stepStatusVariant(step.status)}>
                          {step.status}
                        </Badge>
                      </td>
                      <td>{step.attempts}</td>
                      <td className="muted">{step.modelName ?? "—"}</td>
                      <td className="muted">{formatDateTime(step.startedAt)}</td>
                      <td className="muted">{formatDateTime(step.completedAt)}</td>
                      <td className="text-danger-text text-[length:var(--text-sm)]">
                        {step.lastError ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <h3>Content</h3>
      <Card>
        <article
          className="article prose"
          dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content) }}
        />
      </Card>

      {/* Difficulty feedback distribution (#124) */}
      {difficultyFeedback.total > 0 ? (
        <Card>
          <div className="stack">
            <CardTitle level="h3">Difficulty feedback</CardTitle>
            <p className="muted" style={{ margin: 0 }}>
              {difficultyFeedback.total} reader{difficultyFeedback.total !== 1 ? "s" : ""} rated this article.
            </p>
            <div className="grid grid-cols-3 gap-[var(--space-4)]">
              <Card className="p-[var(--space-4)]">
                <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
                  {difficultyFeedback.tooEasy}
                </div>
                <CardMeta>😴 Too Easy</CardMeta>
              </Card>
              <Card className="p-[var(--space-4)]">
                <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
                  {difficultyFeedback.justRight}
                </div>
                <CardMeta>🎯 Just Right</CardMeta>
              </Card>
              <Card className="p-[var(--space-4)]">
                <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
                  {difficultyFeedback.tooHard}
                </div>
                <CardMeta>🤯 Too Hard</CardMeta>
              </Card>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="stack">
            <CardTitle level="h3">Difficulty feedback</CardTitle>
            <p className="muted" style={{ margin: 0 }}>No difficulty feedback yet.</p>
          </div>
        </Card>
      )}
    </section>
  );
}
