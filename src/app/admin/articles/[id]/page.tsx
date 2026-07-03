import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES, hasCapability } from "@/lib/rbac";
import { statusBadgeVariant } from "@/lib/admin/overview";
import { sanitizeArticleHtml } from "@/lib/content-pipeline";
import {
  articleAccessContext,
  getAdminArticleDetail,
  getArticleTags,
  listContentReviews,
  parseQualityFlags,
  QUALITY_FLAGS,
  readingMinutesFor,
  REVIEW_STATE_LABELS,
  REVIEW_STATES,
  TAKEDOWN_STATE_LABELS,
  TAKEDOWN_STATES,
  type ReviewState,
  type TakedownState,
} from "@/lib/article-library";
import AdminArticleActions from "@/components/AdminArticleActions";
import AdminArticleReview from "@/components/AdminArticleReview";
import AdminArticleTakedown from "@/components/AdminArticleTakedown";
import { Card, CardMeta, CardTitle } from "@/components/ui/Card";
import { Badge, CefrBadge, CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";
import { StatCard } from "@/components/analytics/StatCard";
import { AdminTableWrap } from "@/components/admin";
import { formatDateTime } from "@/lib/display-format";

type BadgeVariant = "success" | "neutral" | "warning" | "danger";
type AdminArticleDetail = NonNullable<
  Awaited<ReturnType<typeof getAdminArticleDetail>>
>;
type AdminArticle = AdminArticleDetail["article"];
type AdminArticleCounts = AdminArticleDetail["counts"];
type DifficultyFeedback = AdminArticleDetail["difficultyFeedback"];
type ProcessingStep = AdminArticleDetail["processingSteps"][number];
type ContentReview = Awaited<ReturnType<typeof listContentReviews>>[number];

const STEP_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  failed: "danger",
  fallback: "warning",
  generated: "success",
  running: "warning",
};

const REVIEW_STATE_VARIANTS: Partial<Record<ReviewState, BadgeVariant>> = {
  approved: "success",
  rejected: "danger",
};

/** Maps a processing-step status to a Badge variant. */
function stepStatusVariant(status: string): BadgeVariant {
  return STEP_STATUS_VARIANTS[status] ?? "neutral";
}

function reviewStatusVariant(reviewState: ReviewState): BadgeVariant {
  return REVIEW_STATE_VARIANTS[reviewState] ?? "warning";
}

function formatReviewChanges(changes: unknown): string {
  return Object.keys((changes as Record<string, unknown>) ?? {}).join(", ") || "—";
}

function articleReviewState(article: AdminArticle): ReviewState | null {
  if (!article.reviewState || article.reviewState === "unreviewed") return null;
  return article.reviewState as ReviewState;
}

function articleTakedownState(article: AdminArticle): TakedownState | null {
  if (!article.takedownState || article.takedownState === "active") return null;
  return article.takedownState as TakedownState;
}

function derivedContentItems(counts: AdminArticleCounts) {
  return [
    { label: "Translations", value: counts.translations },
    { label: "Vocabulary", value: counts.vocabulary },
    { label: "Quiz questions", value: counts.quizQuestions },
    { label: "Tags", value: counts.tags },
    { label: "Narration", value: counts.speech },
    { label: "Reads tracked", value: counts.readingProgress },
  ];
}

function reviewStateOptions() {
  return REVIEW_STATES.map((state) => ({
    value: state,
    label: REVIEW_STATE_LABELS[state],
  }));
}

function takedownStateOptions() {
  return TAKEDOWN_STATES.map((state) => ({
    value: state,
    label: TAKEDOWN_STATE_LABELS[state],
  }));
}

function ArticleMeta({
  article,
  minutes,
}: {
  article: AdminArticle;
  minutes: number | null;
}) {
  const reviewState = articleReviewState(article);
  const takedownState = articleTakedownState(article);
  const hasKnownDifficulty =
    article.difficulty &&
    (CEFR_LEVELS as readonly string[]).includes(article.difficulty);

  return (
    <div className="article-meta muted">
      <Badge variant={statusBadgeVariant(article.status)}>
        {article.status}
      </Badge>
      {reviewState ? (
        <Badge variant={reviewStatusVariant(reviewState)}>
          {REVIEW_STATE_LABELS[reviewState] ?? article.reviewState}
        </Badge>
      ) : null}
      {takedownState ? (
        <Badge variant="danger">
          {TAKEDOWN_STATE_LABELS[takedownState] ?? article.takedownState}
        </Badge>
      ) : null}
      {hasKnownDifficulty ? (
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
  );
}

function SourceLink({ article }: { article: AdminArticle }) {
  if (!article.sourceUrl) return null;

  return (
    <p className="muted" style={{ margin: 0 }}>
      Source:{" "}
      <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
        {article.sourceUrl}
      </a>
    </p>
  );
}

function DerivedContentCard({
  articleId,
  counts,
}: {
  articleId: string;
  counts: AdminArticleCounts;
}) {
  return (
    <Card>
      <div className="stack">
        <CardTitle level="h3">Derived content</CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
          {derivedContentItems(counts).map((item) => (
            <StatCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
        <AdminArticleActions articleId={articleId} redirectOnDelete="/admin/articles" />
      </div>
    </Card>
  );
}

function ModerationReviewCard({
  article,
  articleTagNames,
  currentFlags,
}: {
  article: AdminArticle;
  articleTagNames: string;
  currentFlags: string[];
}) {
  return (
    <Card>
      <div className="stack">
        <CardTitle level="h3">Moderation &amp; review</CardTitle>
        <p className="muted" style={{ margin: 0 }}>
          Correct metadata, set the review verdict, and adjust quality flags.
          Every save is recorded in the review history below.
        </p>
        <AdminArticleReview
          articleId={article.id}
          reviewStateOptions={reviewStateOptions()}
          qualityFlagOptions={[...QUALITY_FLAGS]}
          initial={{
            title: article.title,
            excerpt: article.excerpt ?? "",
            category: article.category ?? "",
            difficulty: article.difficulty ?? "",
            status: article.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
            reviewState: article.reviewState ?? "unreviewed",
            qualityFlags: currentFlags,
            tags: articleTagNames,
          }}
        />
      </div>
    </Card>
  );
}

function RightsTakedownCard({ article }: { article: AdminArticle }) {
  return (
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
          stateOptions={takedownStateOptions()}
          currentRightsNote={article.rightsNote ?? ""}
        />
      </div>
    </Card>
  );
}

function ReviewHistoryCard({ reviews }: { reviews: ContentReview[] }) {
  if (reviews.length === 0) return null;

  return (
    <Card>
      <div className="stack">
        <CardTitle level="h3">Review history</CardTitle>
        <AdminTableWrap ariaLabel="Review history table (scrollable)">
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
                  {formatReviewChanges(r.changes)}
                </td>
                <td className="muted text-[length:var(--text-sm)]">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      </div>
    </Card>
  );
}

function ProcessingStepRow({ step }: { step: ProcessingStep }) {
  return (
    <tr>
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
  );
}

function ProcessingStateCard({
  processingSteps,
}: {
  processingSteps: ProcessingStep[];
}) {
  return (
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
          <AdminTableWrap ariaLabel="Processing steps table (scrollable)">
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
                <ProcessingStepRow key={step.id} step={step} />
              ))}
            </tbody>
          </AdminTableWrap>
        )}
      </div>
    </Card>
  );
}

function DifficultyStatCard({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <Card className="p-[var(--space-4)]">
      <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
        {value}
      </div>
      <CardMeta>{label}</CardMeta>
    </Card>
  );
}

function DifficultyFeedbackCard({
  difficultyFeedback,
}: {
  difficultyFeedback: DifficultyFeedback;
}) {
  if (difficultyFeedback.total === 0) {
    return (
      <Card>
        <div className="stack">
          <CardTitle level="h3">Difficulty feedback</CardTitle>
          <p className="muted" style={{ margin: 0 }}>No difficulty feedback yet.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="stack">
        <CardTitle level="h3">Difficulty feedback</CardTitle>
        <p className="muted" style={{ margin: 0 }}>
          {difficultyFeedback.total} reader{difficultyFeedback.total !== 1 ? "s" : ""} rated this article.
        </p>
        <div className="grid grid-cols-3 gap-[var(--space-4)]">
          <DifficultyStatCard value={difficultyFeedback.tooEasy} label="😴 Too Easy" />
          <DifficultyStatCard value={difficultyFeedback.justRight} label="🎯 Just Right" />
          <DifficultyStatCard value={difficultyFeedback.tooHard} label="🤯 Too Hard" />
        </div>
      </div>
    </Card>
  );
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
  const articleTagNames = articleTags.map((tag) => tag.name).join(", ");

  return (
    <section className="stack">
      <Link href="/admin/articles" className="muted">
        ← Back to articles
      </Link>

      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        {article.title}
      </h1>
      <ArticleMeta article={article} minutes={minutes} />
      <SourceLink article={article} />
      <DerivedContentCard articleId={article.id} counts={counts} />

      {canModerate && (
        <ModerationReviewCard
          article={article}
          articleTagNames={articleTagNames}
          currentFlags={currentFlags}
        />
      )}

      {canModerate && <RightsTakedownCard article={article} />}

      {canModerate && <ReviewHistoryCard reviews={reviews} />}

      <ProcessingStateCard processingSteps={processingSteps} />

      <h3>Content</h3>
      <Card>
        <article
          className="article prose"
          dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content) }}
        />
      </Card>

      {/* Difficulty feedback distribution (#124) */}
      <DifficultyFeedbackCard difficultyFeedback={difficultyFeedback} />
    </section>
  );
}
