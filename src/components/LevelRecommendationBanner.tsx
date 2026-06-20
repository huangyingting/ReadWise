"use client";

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

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

const DISMISS_KEY = "readwise:level-rec-dismissed";

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

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) {
      setDismissed(true);
      return;
    }
    fetch("/api/level-recommendation")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Recommendation | null) => {
        if (data && data.suggestion !== "hold" && data.confidence >= 0.6) {
          setRec(data);
        }
      })
      .catch(() => null);
  }, []);

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
      setApplying(false);
    }
  }

  if (dismissed || !rec) return null;

  const isUp = rec.suggestion === "up";
  const Icon = isUp ? TrendingUp : TrendingDown;
  const accentColor = isUp ? "var(--success)" : "var(--warning)";
  const accentText = isUp ? "var(--success-text)" : "var(--warning-text)";

  if (applied) {
    return (
      <div
        role="status"
        className="rw-fade-up flex items-center gap-[var(--space-3)] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-border bg-surface mb-[var(--space-6)]"
      >
        <Icon size={20} aria-hidden style={{ color: accentColor, flexShrink: 0 }} />
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
        className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full"
        style={{
          background: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
          color: accentText,
        }}
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
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss level recommendation"
        className="shrink-0 text-text-subtle hover:text-text transition-colors"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

