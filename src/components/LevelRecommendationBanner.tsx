"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, X, ChevronRight } from "lucide-react";
import { Button, IconButton, PanelError } from "@/components/ui";
import { cn } from "@/lib/cn";
import { STORAGE_KEYS } from "@/lib/storage-keys";

type Suggestion = "up" | "down" | "hold";

type Recommendation = {
  suggestion: Suggestion;
  confidence: number;
  rationale: string;
  targetLevel: string | null;
  currentLevel: string;
};

/** Serializable slice of the profile needed for the level-update PUT. */
export type ProfileSnapshot = {
  englishLevel: string;
  ageRange: string | null;
  gender: string | null;
  topics: string[];
  dailyGoal?: number;
};

interface LevelRecommendationBannerProps {
  /** Current profile fields — passed from server so we don't need a GET /api/profile call. */
  profile: ProfileSnapshot;
}

const DISMISS_KEY = STORAGE_KEYS.LEVEL_REC_DISMISSED;
const MIN_RECOMMENDATION_CONFIDENCE = 0.6;

function shouldShowRecommendation(data: Recommendation | null | undefined): data is Recommendation {
  return (
    data != null &&
    data.suggestion !== "hold" &&
    data.confidence >= MIN_RECOMMENDATION_CONFIDENCE
  );
}

/**
 * Fetches the level recommendation from the API and shows a dismissible banner
 * when confidence is high enough (≥ 0.6). Accepting calls PUT /api/profile to
 * update the user's CEFR level; dismissing stores a flag in sessionStorage so
 * the banner doesn't reappear for the rest of the session.
 */
export default function LevelRecommendationBanner({
  profile,
}: LevelRecommendationBannerProps) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const loadRecommendation = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/level-recommendation");
      if (!res.ok) throw new Error("recommendation failed");
      const data = (await res.json()) as Recommendation | null;
      setRec(shouldShowRecommendation(data) ? data : null);
    } catch {
      setRec(null);
      setLoadError("Level recommendation couldn’t load.");
    }
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) {
      setDismissed(true);
      return;
    }
    void loadRecommendation();
  }, [loadRecommendation]);

  function dismiss() {
    setDismissing(true);
    // animationend fires after rw-dismiss-out completes; fallback timer handles
    // prefers-reduced-motion (animation is no-op'd but animationend still fires).
  }

  function handleDismissAnimationEnd() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function accept() {
    if (!rec?.targetLevel || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          englishLevel: rec.targetLevel,
        }),
      });
      if (!res.ok) throw new Error("update failed");
      setApplied(true);
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      setApplyError("Couldn’t update your level. Please retry.");
      setApplying(false);
    }
  }

  if (dismissed) return null;

  if (loadError) {
    return (
      <div className="rw-fade-up flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-border bg-surface p-[var(--space-4)] mb-[var(--space-6)]">
        <PanelError message={loadError} />
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadRecommendation()}>
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              sessionStorage.setItem(DISMISS_KEY, "1");
              setDismissed(true);
            }}
          >
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  if (!rec) return null;

  const isUp = rec.suggestion === "up";
  const Icon = isUp ? TrendingUp : TrendingDown;
  const accentIconClass = isUp ? "text-success" : "text-warning";
  const accentBadgeClass = isUp
    ? "bg-[var(--success-bg)] text-success-text"
    : "bg-[var(--warning-bg)] text-warning-text";

  if (applied) {
    return (
      <div
        role="status"
        className="rw-fade-up flex items-center gap-[var(--space-3)] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-border bg-surface mb-[var(--space-6)]"
      >
        <Icon size={20} aria-hidden className={cn("shrink-0", accentIconClass)} />
        <p className="text-[length:var(--text-sm)] text-text m-0">
          Level updated to <strong>{rec.targetLevel}</strong>! Your feed and Picks will reflect your new level.
        </p>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Level recommendation"
      onAnimationEnd={dismissing ? handleDismissAnimationEnd : undefined}
      className={`${dismissing ? "rw-dismiss-out" : "rw-fade-up"} flex items-start gap-[var(--space-3)] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-border bg-surface mb-[var(--space-6)]`}
    >
      <div
        className={cn(
          "shrink-0 flex items-center justify-center w-9 h-9 rounded-full",
          accentBadgeClass,
        )}
        aria-hidden
      >
        <Icon size={18} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[length:var(--text-sm)] font-semibold text-text m-0">
          {isUp ? `Ready for ${rec.targetLevel}?` : `Try ${rec.targetLevel}?`}
        </p>
        <p className="text-[length:var(--text-sm)] text-text-muted m-0 mt-[var(--space-1)]">
          {rec.rationale}
        </p>
        <div className="flex items-center gap-[var(--space-2)] mt-[var(--space-3)]">
          <Button
            size="sm"
            variant="primary"
            leadingIcon={<ChevronRight size={14} aria-hidden />}
            onClick={() => void accept()}
            disabled={applying}
          >
            {applying ? "Updating…" : `Switch to ${rec.targetLevel}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
        {applyError ? (
          <div className="mt-[var(--space-3)] flex flex-col gap-[var(--space-2)]">
            <PanelError message={applyError} />
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void accept()}>
                Retry update
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <IconButton
        onClick={dismiss}
        aria-label="Dismiss level recommendation"
        className="h-11 w-11 rounded-[var(--radius-md)] text-text-subtle hover:text-text"
      >
        <X size={16} aria-hidden />
      </IconButton>
    </div>
  );
}
