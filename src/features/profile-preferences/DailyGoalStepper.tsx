"use client";

import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { DAILY_GOAL_MIN, DAILY_GOAL_MAX } from "./values";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Field";

interface DailyGoalStepperProps {
  value: number;
  onChange: (value: number) => void;
}

/**
 * Stepper control for the articles-per-day reading goal.
 * Used in the profile settings form and extracted here so it can be reused
 * in future surfaces (e.g. an inline onboarding goal step).
 */
export function DailyGoalStepper({ value, onChange }: DailyGoalStepperProps) {
  const uid = useId();
  const dailyGoalId = `${uid}-daily-goal`;
  const dailyGoalHintId = `${uid}-daily-goal-hint`;

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <Label htmlFor={dailyGoalId}>Daily reading goal</Label>
      <p
        id={dailyGoalHintId}
        className="text-text-subtle text-[length:var(--text-xs)]"
      >
        Articles to read per day. Powers your dashboard streak ring.
      </p>
      <div className="inline-flex items-center gap-[var(--space-3)]">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Decrease daily goal"
          onClick={() => onChange(Math.max(DAILY_GOAL_MIN, value - 1))}
          disabled={value <= DAILY_GOAL_MIN}
        >
          <Minus size={16} aria-hidden />
        </Button>
        <Input
          id={dailyGoalId}
          type="number"
          inputSize="sm"
          min={DAILY_GOAL_MIN}
          max={DAILY_GOAL_MAX}
          step={1}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) onChange(v);
          }}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            const clamped = isNaN(v)
              ? DAILY_GOAL_MIN
              : Math.max(DAILY_GOAL_MIN, Math.min(DAILY_GOAL_MAX, v));
            onChange(clamped);
          }}
          aria-describedby={dailyGoalHintId}
          className="w-[3.5rem] text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Increase daily goal"
          onClick={() => onChange(Math.min(DAILY_GOAL_MAX, value + 1))}
          disabled={value >= DAILY_GOAL_MAX}
        >
          <Plus size={16} aria-hidden />
        </Button>
        <span className="text-text-muted text-[length:var(--text-sm)]">
          {value === 1 ? "article" : "articles"} / day
        </span>
      </div>
      {/* Reserve error row height (Field parity) */}
      <p className="min-h-[1.25em]" />
    </div>
  );
}
