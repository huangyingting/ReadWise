/**
 * FluencySection — reading-fluency trend panel for the Progress page (#813).
 *
 * Shows the learner's level/topic-agnostic reading-fluency trend with
 * deterministic, NON-PUNITIVE copy (a declining trend is framed positively:
 * slower reads often mean harder content). Displays the aggregate average WPM
 * and the sample count only — never any per-article WPM value.
 */
import { TrendingUp, Minus, TrendingDown, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { t } from "@/lib/i18n";
import type { FluencyTrend, FluencyTrendValue } from "@/lib/engagement";

interface FluencySectionProps {
  fluencyTrend: FluencyTrend;
}

type TrendDisplay = {
  Icon: typeof TrendingUp;
  badge: { label: string; variant: "success" | "neutral" | "primary" };
};

const TREND_DISPLAY: Record<FluencyTrendValue, TrendDisplay> = {
  improving: {
    Icon: TrendingUp,
    badge: { label: "Improving", variant: "success" },
  },
  stable: {
    Icon: Minus,
    badge: { label: "Steady", variant: "primary" },
  },
  declining: {
    Icon: TrendingDown,
    badge: { label: "Deeper reading", variant: "neutral" },
  },
  insufficient_data: {
    Icon: Sparkles,
    badge: { label: "Building up", variant: "neutral" },
  },
};

function getFluencyMetaCopy(avgWpm: number | null, sampleCount: number) {
  const averagePrefix = avgWpm !== null
    ? `Around ${avgWpm} words per minute · `
    : "";
  const sessionLabel = sampleCount !== 1 ? "sessions" : "session";

  return `${averagePrefix}${sampleCount} reading ${sessionLabel} measured`;
}

export function FluencySection({ fluencyTrend }: FluencySectionProps) {
  const { trend, avgWpm, sampleCount } = fluencyTrend;
  const { Icon, badge } = TREND_DISPLAY[trend];
  const copy = t(`fluency.trend.${trend}`);
  const metaCopy = getFluencyMetaCopy(avgWpm, sampleCount);

  return (
    <section aria-labelledby="fluency-h">
      <h2
        id="fluency-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Reading fluency
      </h2>
      <Card>
        <div className="flex items-start gap-[var(--space-4)]">
          <span
            aria-hidden="true"
            className="flex h-[var(--space-9)] w-[var(--space-9)] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-bg-subtle text-[color:var(--primary)]"
          >
            <Icon size={20} />
          </span>
          <div className="flex flex-col gap-[var(--space-2)]">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <p className="text-[length:var(--text-base)] text-text">{copy}</p>
            <p className="text-[length:var(--text-xs)] text-text-subtle">
              {metaCopy}
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}
