"use client";

/**
 * CEFR level progression timeline (Issue #97).
 *
 * Renders a step-chart showing the user's level history.
 * If there are no level-change records, shows an "empty" state
 * with the current level and guidance.
 */

import {
  ENGLISH_LEVELS,
  LEVEL_HINTS,
  type EnglishLevel,
} from "@/lib/option-registries";
import { CefrBadge } from "@/components/ui/Badge";
import type { LevelEntry } from "@/lib/progress-helpers";
import { formatMonthYear } from "@/lib/display-format";

const CEFR_START_LABEL = "A1";
const CEFR_END_LABEL = "C2";

/** Width percentage for a CEFR level in the timeline scale. */
function levelPct(level: EnglishLevel): number {
  const rank = ENGLISH_LEVELS.indexOf(level); // 0–5
  return Math.round(((rank + 1) / ENGLISH_LEVELS.length) * 100);
}

function nextLevelAfter(level: EnglishLevel): EnglishLevel | null {
  const nextRank = ENGLISH_LEVELS.indexOf(level) + 1;
  return nextRank < ENGLISH_LEVELS.length ? ENGLISH_LEVELS[nextRank] : null;
}

function TimelineScale({
  pct,
  height,
  animated = false,
}: {
  pct: number;
  height: number;
  animated?: boolean;
}) {
  return (
    <div>
      <div
        className="relative w-full rounded-full overflow-hidden"
        style={{ height, backgroundColor: "var(--border)" }}
        role="presentation"
        aria-hidden
      >
        <div
          className={`absolute left-0 top-0 h-full rounded-full${
            animated ? " transition-all" : ""
          }`}
          style={{ width: `${pct}%`, backgroundColor: "var(--teal)" }}
        />
      </div>
      <div className="flex justify-between mt-[var(--space-1)]">
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {CEFR_START_LABEL}
        </span>
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {CEFR_END_LABEL}
        </span>
      </div>
    </div>
  );
}

function EmptyTimeline({ currentLevel }: { currentLevel: EnglishLevel }) {
  const pct = levelPct(currentLevel);
  const nextLevel = nextLevelAfter(currentLevel);

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <CefrBadge level={currentLevel} />
        <span className="text-[length:var(--text-sm)] text-text-subtle">
          {LEVEL_HINTS[currentLevel] ?? currentLevel}
        </span>
      </div>

      <TimelineScale pct={pct} height={12} animated />

      <p className="text-[length:var(--text-sm)] text-text-subtle">
        {nextLevel ? (
          <>
            You&apos;re currently at{" "}
            <strong className="text-text font-semibold">{currentLevel}</strong>.
            Keep reading and taking quizzes to work toward{" "}
            <strong className="text-text font-semibold">{nextLevel}</strong>.
            When the app detects consistent mastery it will suggest a level change.
          </>
        ) : (
          <>
            You&apos;ve reached{" "}
            <strong className="text-text font-semibold">C2 — Mastery</strong>!
            Keep reading to maintain your proficiency.
          </>
        )}
      </p>

      <p className="text-[length:var(--text-xs)] text-text-subtle italic">
        Level changes appear here once you accept a level-up or level-down suggestion.
      </p>
    </div>
  );
}

interface StepNode {
  level: EnglishLevel;
  date: string; // formatted
  isCurrent: boolean;
}

function buildTimelineNodes(
  history: LevelEntry[],
  currentLevel: EnglishLevel,
): StepNode[] {
  const currentDate = formatMonthYear(new Date().toISOString());
  const nodes: StepNode[] = [
    ...history.map((entry) => ({
      level: entry.level,
      date: formatMonthYear(entry.changedAt),
      isCurrent: false,
    })),
    {
      level: currentLevel,
      date: currentDate,
      isCurrent: true,
    },
  ];

  return nodes.reduce<StepNode[]>((acc, node) => {
    const prev = acc[acc.length - 1];
    if (prev && !prev.isCurrent && prev.level === node.level && node.isCurrent) {
      acc[acc.length - 1] = { ...prev, isCurrent: true };
      return acc;
    }
    acc.push(node);
    return acc;
  }, []);
}

function TimelineChart({
  nodes,
  currentLevel,
}: {
  nodes: StepNode[];
  currentLevel: EnglishLevel;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      {/* Step node list */}
      <ol
        aria-label="CEFR level progression timeline"
        className="flex flex-wrap items-center gap-x-0 gap-y-[var(--space-4)]"
      >
        {nodes.map((node, idx) => (
          <li
            key={idx}
            className="flex items-center"
            aria-label={
              node.isCurrent
                ? `Current level: ${node.level}`
                : `${node.level} since ${node.date}`
            }
          >
            {/* Connector line (not before first node) */}
            {idx > 0 && (
              <div
                className="hidden sm:block"
                style={{
                  width: 40,
                  height: 2,
                  backgroundColor: "var(--border)",
                  flexShrink: 0,
                }}
                aria-hidden
              />
            )}

            {/* Node */}
            <div className="flex flex-col items-center gap-[var(--space-1)]">
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 40,
                  height: 40,
                  backgroundColor: node.isCurrent
                    ? "color-mix(in srgb, var(--teal) 20%, transparent)"
                    : "var(--bg-subtle)",
                  border: `2px solid ${
                    node.isCurrent ? "var(--teal)" : "var(--border)"
                  }`,
                }}
                aria-hidden
              >
                <span
                  className="text-[length:var(--text-sm)] font-bold"
                  style={{
                    color: node.isCurrent
                      ? "var(--teal-text)"
                      : "var(--text-subtle)",
                  }}
                >
                  {node.level}
                </span>
              </div>
              <span className="text-[length:var(--text-xs)] text-text-subtle whitespace-nowrap">
                {node.isCurrent ? "Now" : node.date}
              </span>
              {node.isCurrent && (
                <CefrBadge level={node.level} className="mt-[var(--space-1)]" />
              )}
            </div>
          </li>
        ))}
      </ol>

      <TimelineScale pct={levelPct(currentLevel)} height={8} />
    </div>
  );
}

interface LevelTimelineProps {
  history: LevelEntry[];
  currentLevel: EnglishLevel;
}

/**
 * CEFR level progression timeline.
 *
 * Shows a step-chart when the user has level-change history,
 * or an informative empty state when they don't.
 */
export default function LevelTimeline({
  history,
  currentLevel,
}: LevelTimelineProps) {
  if (history.length === 0) {
    return <EmptyTimeline currentLevel={currentLevel} />;
  }

  return (
    <TimelineChart
      nodes={buildTimelineNodes(history, currentLevel)}
      currentLevel={currentLevel}
    />
  );
}
