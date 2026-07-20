"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Badge, Field, Skeleton, Spinner, Switch, Textarea } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { getJson, postJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";
import {
  MAX_RESOLVE_REASON,
  classifyConflictResolveError,
  conflictStatusBadge,
  dependentDataItems,
  describeResolveOutcome,
  isResolveReasonValid,
  summarizeDependentData,
  totalDependentData,
  type CanonicalConflictDetail,
  type ConflictArticle,
  type ConflictResolveError,
  type ConflictResolveResponse,
  type TypeBCanonicalChoice,
} from "@/lib/scraper/incremental/canonical-conflict-ui";

const DASH = "—";

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; detail: CanonicalConflictDetail };

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <dt className="text-text-muted text-[length:var(--text-xs)]">{label}</dt>
      <dd className="m-0 text-[length:var(--text-sm)] break-words">{children}</dd>
    </div>
  );
}

interface ConflictDetailSheetProps {
  conflictId: string | null;
  onClose: () => void;
  /** Called after a state-changing (or idempotent) resolution: reload + banner. */
  onResolved: (message: string) => void;
}

/**
 * Detail drawer for one canonical conflict (#1104, AC1). Fetches the sanitized
 * detail DTO (identity + contested public Article ids + per-Article + aggregate
 * dependent-data COUNTS) from `/api/admin/canonical-conflicts/{id}` and, for an
 * OPEN conflict, hosts the RESOLVE control: the operator selects the surviving
 * Article from the contested participants, supplies a required audit reason, and
 * flips an explicit confirm toggle before resolving (the API rejects
 * `confirm:false`). Shows only sanitized identity + counts — never a URL, body,
 * secret, or article content.
 */
export default function ConflictDetailSheet({ conflictId, onClose, onResolved }: ConflictDetailSheetProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });

  const load = useCallback(async (id: string) => {
    setState({ status: "loading" });
    try {
      const detail = await getJson<CanonicalConflictDetail>(
        `/api/admin/canonical-conflicts/${encodeURIComponent(id)}`,
      );
      setState({ status: "ready", detail });
    } catch (err) {
      setState({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, []);

  useEffect(() => {
    if (conflictId) void load(conflictId);
  }, [conflictId, load]);

  return (
    <Sheet open={conflictId !== null} onClose={onClose} side="right" label="Canonical conflict details">
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--text-lg)] font-[family-name:var(--font-display)] font-semibold">
          Conflict details
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close details">
          Close
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
        {state.status === "loading" && (
          <div className="flex flex-col gap-[var(--space-3)]" aria-busy="true">
            <span className="sr-only" role="status">
              <Spinner size="sm" /> Loading conflict details
            </span>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[var(--space-6)] w-full" />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <p role="alert" className="m-0 text-danger-text text-[length:var(--text-sm)]">
              {state.error.kind === "forbidden"
                ? "You don't have access to view this conflict."
                : state.error.kind === "notFound"
                  ? "This conflict no longer exists."
                  : "Couldn't load conflict details."}
            </p>
            {conflictId && state.error.kind !== "forbidden" && (
              <Button variant="outline" size="sm" onClick={() => void load(conflictId)}>
                Retry
              </Button>
            )}
          </div>
        )}

        {state.status === "ready" && (
          <ConflictDetailBody
            detail={state.detail}
            onResolved={onResolved}
            onReload={() => conflictId && void load(conflictId)}
          />
        )}
      </div>
    </Sheet>
  );
}

function ConflictDetailBody({
  detail,
  onResolved,
  onReload,
}: {
  detail: CanonicalConflictDetail;
  onResolved: (message: string) => void;
  onReload: () => void;
}) {
  const badge = conflictStatusBadge(detail.status);
  const total = totalDependentData(detail.dependentData);
  const isTypeB = detail.kind === "type-b";
  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <Badge variant={isTypeB ? "primary" : "neutral"}>
          {isTypeB ? "Runtime conflict" : "Baseline conflict"}
        </Badge>
        <span className="text-text-muted text-[length:var(--text-xs)]">v{detail.identityVersion}</span>
      </div>

      <dl className="grid grid-cols-2 gap-[var(--space-4)] m-0">
        <DetailRow label="Provider">{detail.providerKey}</DetailRow>
        <DetailRow label="Reason">{detail.reason ?? DASH}</DetailRow>
        <DetailRow label="Canonical key">
          <code className="text-[length:var(--text-xs)] break-all">{detail.canonicalKey}</code>
        </DetailRow>
        <DetailRow label="Challenger key">
          <code className="text-[length:var(--text-xs)] break-all">{detail.challengerKey}</code>
        </DetailRow>
        <DetailRow label="Detected">{formatDateTime(detail.detectedAt)}</DetailRow>
        <DetailRow label="Resolved">
          {detail.resolvedAt ? formatDateTime(detail.resolvedAt) : DASH}
        </DetailRow>
        <DetailRow label="Resolved by">{detail.resolvedBy ?? DASH}</DetailRow>
        <DetailRow label="Reader data">{total === 0 ? "None" : summarizeDependentData(detail.dependentData)}</DetailRow>
      </dl>

      <section className="flex flex-col gap-[var(--space-2)]">
        <h3 className="m-0 text-[length:var(--text-sm)] font-semibold">
          Contested articles ({detail.conflictingArticleIds.length})
        </h3>
        {detail.articles.length === 0 ? (
          <p className="m-0 text-text-muted text-[length:var(--text-sm)]">
            No contested public article to resolve onto.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
            {detail.articles.map((article) => (
              <ArticleCountsRow key={article.articleId} article={article} />
            ))}
          </ul>
        )}
      </section>

      {detail.status === "OPEN" ? (
        detail.kind === "type-b" ? (
          <ResolveFormTypeB detail={detail} onResolved={onResolved} onReload={onReload} />
        ) : detail.articles.length > 0 ? (
          <ResolveFormTypeA detail={detail} onResolved={onResolved} onReload={onReload} />
        ) : (
          <p className="m-0 text-text-muted text-[length:var(--text-sm)]">
            This conflict has no contested public article and cannot be resolved.
          </p>
        )
      ) : (
        <p className="m-0 text-text-muted text-[length:var(--text-sm)]">
          This conflict is already {detail.status.toLowerCase()}.
        </p>
      )}
    </div>
  );
}

function ArticleCountsRow({ article }: { article: ConflictArticle }) {
  const items = dependentDataItems(article.dependentData);
  return (
    <li className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-3)] py-[var(--space-2)]">
      <code className="text-[length:var(--text-xs)] break-all">{article.articleId}</code>
      <span className="text-text-muted text-[length:var(--text-xs)]">
        {items.length === 0
          ? "No reader data"
          : items.map((item) => `${item.value} ${item.label.toLowerCase()}`).join(" · ")}
      </span>
    </li>
  );
}

function ResolveFormTypeA({
  detail,
  onResolved,
  onReload,
}: {
  detail: CanonicalConflictDetail;
  onResolved: (message: string) => void;
  onReload: () => void;
}) {
  const [survivor, setSurvivor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [migrateReaderData, setMigrateReaderData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConflictResolveError | null>(null);
  const groupName = useId();
  const reasonFieldId = useId();

  const reasonValid = isResolveReasonValid(reason);
  const canSubmit = survivor !== null && reasonValid && confirm && !busy;

  async function submit() {
    if (!canSubmit || survivor === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<ConflictResolveResponse>(
        `/api/admin/canonical-conflicts/${encodeURIComponent(detail.id)}/resolve`,
        { survivingArticleId: survivor, reason: reason.trim(), confirm: true, migrateReaderData },
      );
      onResolved(describeResolveOutcome(res));
    } catch (err) {
      setError(classifyConflictResolveError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border bg-surface px-[var(--space-4)] py-[var(--space-4)]">
      <h3 className="m-0 text-[length:var(--text-sm)] font-semibold">Resolve conflict</h3>
      <p className="m-0 text-text-muted text-[length:var(--text-xs)]">
        Pick the surviving article. The other contested articles are archived out of
        public feeds. This is destructive and audited.
      </p>

      <fieldset className="m-0 flex flex-col gap-[var(--space-2)] border-0 p-0">
        <legend className="mb-[var(--space-1)] p-0 text-[length:var(--text-xs)] text-text-muted">
          Surviving article
        </legend>
        {detail.articles.map((article) => {
          const items = dependentDataItems(article.dependentData);
          return (
            <label
              key={article.articleId}
              className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]"
            >
              <input
                type="radio"
                name={groupName}
                className="mt-[var(--space-1)] size-4 accent-[var(--primary)] cursor-pointer"
                checked={survivor === article.articleId}
                disabled={busy}
                onChange={() => setSurvivor(article.articleId)}
                aria-label={`Keep article ${article.articleId} as the survivor`}
              />
              <span className="flex flex-col gap-[var(--space-1)]">
                <code className="text-[length:var(--text-xs)] break-all">{article.articleId}</code>
                <span className="text-text-muted text-[length:var(--text-xs)]">
                  {items.length === 0
                    ? "No reader data"
                    : items.map((item) => `${item.value} ${item.label.toLowerCase()}`).join(" · ")}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <Field
        label="Reason to resolve"
        hint="Recorded in the audit log (1–500 characters). Never include private content."
        required
      >
        <Textarea
          id={reasonFieldId}
          rows={3}
          maxLength={MAX_RESOLVE_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this the surviving identity?"
        />
      </Field>

      <label className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)]">
        <Switch
          checked={migrateReaderData}
          onCheckedChange={setMigrateReaderData}
          disabled={busy}
          aria-label="Also migrate reader and learning data onto the surviving article"
        />
        <span>
          Also migrate reader &amp; learning data (highlights, progress, quiz/pronunciation
          history) onto the surviving article. Off by default: reader data is retained in
          place on the archived articles.
        </span>
      </label>

      <label className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)]">
        <Switch
          checked={confirm}
          onCheckedChange={setConfirm}
          aria-label="Confirm the destructive resolution"
        />
        <span>I understand the losing articles are archived out of public feeds.</span>
      </label>

      {error && <ResolveErrorBanner error={error} onRefresh={onReload} />}

      <div className="flex justify-end">
        <Button variant="danger" size="sm" loading={busy} disabled={!canSubmit} onClick={submit}>
          Resolve conflict
        </Button>
      </div>
    </section>
  );
}

/**
 * Runtime (Type B) resolution form (#1135): the operator declares which of the two
 * contending candidates is canonical — keep the INCUMBENT (folds the challenger as
 * a duplicate) or promote the CHALLENGER (transfers the canonical claim, folds the
 * incumbent, and archives + retains the incumbent's produced Article). Same
 * required audit `reason` + explicit `confirm` gating as Type A; posts `canonical`
 * (never `survivingArticleId`), matching the resolver's Type-B selector shape.
 */
function ResolveFormTypeB({
  detail,
  onResolved,
  onReload,
}: {
  detail: CanonicalConflictDetail;
  onResolved: (message: string) => void;
  onReload: () => void;
}) {
  const [canonical, setCanonical] = useState<TypeBCanonicalChoice | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConflictResolveError | null>(null);
  const groupName = useId();
  const reasonFieldId = useId();

  const reasonValid = isResolveReasonValid(reason);
  const canSubmit = canonical !== null && reasonValid && confirm && !busy;

  async function submit() {
    if (!canSubmit || canonical === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<ConflictResolveResponse>(
        `/api/admin/canonical-conflicts/${encodeURIComponent(detail.id)}/resolve`,
        { canonical, reason: reason.trim(), confirm: true },
      );
      onResolved(describeResolveOutcome(res));
    } catch (err) {
      setError(classifyConflictResolveError(err));
    } finally {
      setBusy(false);
    }
  }

  const incumbentLabel = detail.incumbentArticle
    ? detail.incumbentArticle.title
    : detail.incumbentCandidateId
      ? `Candidate ${detail.incumbentCandidateId}`
      : "Incumbent candidate";

  return (
    <section className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border bg-surface px-[var(--space-4)] py-[var(--space-4)]">
      <h3 className="m-0 text-[length:var(--text-sm)] font-semibold">Resolve runtime conflict</h3>
      <p className="m-0 text-text-muted text-[length:var(--text-xs)]">
        A live challenger resolved to an identity an incumbent already owns. Choose which
        candidate is canonical. This is destructive and audited.
      </p>

      <fieldset className="m-0 flex flex-col gap-[var(--space-2)] border-0 p-0">
        <legend className="mb-[var(--space-1)] p-0 text-[length:var(--text-xs)] text-text-muted">
          Canonical decision
        </legend>

        <label className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]">
          <input
            type="radio"
            name={groupName}
            className="mt-[var(--space-1)] size-4 accent-[var(--primary)] cursor-pointer"
            checked={canonical === "incumbent"}
            disabled={busy}
            onChange={() => setCanonical("incumbent")}
            aria-label="Keep the incumbent as canonical"
          />
          <span className="flex flex-col gap-[var(--space-1)]">
            <span className="font-semibold">Keep incumbent</span>
            <span className="break-words">{incumbentLabel}</span>
            {detail.incumbentArticle?.slug && (
              <code className="text-[length:var(--text-xs)] break-all">
                /{detail.incumbentArticle.slug}
              </code>
            )}
            <span className="text-text-muted text-[length:var(--text-xs)]">
              The incumbent keeps its canonical claim and article; the challenger is folded
              in as a duplicate.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]">
          <input
            type="radio"
            name={groupName}
            className="mt-[var(--space-1)] size-4 accent-[var(--primary)] cursor-pointer"
            checked={canonical === "challenger"}
            disabled={busy}
            onChange={() => setCanonical("challenger")}
            aria-label="Promote the challenger to canonical"
          />
          <span className="flex flex-col gap-[var(--space-1)]">
            <span className="font-semibold">Promote challenger</span>
            <code className="text-[length:var(--text-xs)] break-all">{detail.challengerKey}</code>
            <span className="text-text-muted text-[length:var(--text-xs)]">
              The canonical claim transfers to the challenger; the incumbent is folded in and
              its produced article is archived out of public feeds (retained, never deleted).
            </span>
          </span>
        </label>
      </fieldset>

      <Field
        label="Reason to resolve"
        hint="Recorded in the audit log (1–500 characters). Never include private content."
        required
      >
        <Textarea
          id={reasonFieldId}
          rows={3}
          maxLength={MAX_RESOLVE_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this the canonical identity?"
        />
      </Field>

      <label className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)]">
        <Switch
          checked={confirm}
          onCheckedChange={setConfirm}
          aria-label="Confirm the destructive resolution"
        />
        <span>I understand the folded candidate&apos;s article is archived out of public feeds.</span>
      </label>

      {error && <ResolveErrorBanner error={error} onRefresh={onReload} />}

      <div className="flex justify-end">
        <Button variant="danger" size="sm" loading={busy} disabled={!canSubmit} onClick={submit}>
          Resolve conflict
        </Button>
      </div>
    </section>
  );
}

function ResolveErrorBanner({
  error,
  onRefresh,
}: {
  error: ConflictResolveError;
  onRefresh: () => void;
}) {
  if (error.kind === "stale") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warning)_34%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-warning-text"
      >
        <span>{error.message} Refresh &amp; retry.</span>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
    );
  }
  return (
    <p
      role="alert"
      className="m-0 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-danger-text"
    >
      {error.message}
    </p>
  );
}
