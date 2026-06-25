"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus } from "lucide-react";
import { ApiResponseError, putJson } from "@/lib/client-fetch";
import { CATEGORIES } from "@/lib/categories";
import {
  AGE_RANGES,
  ENGLISH_LEVELS,
  GENDERS,
  DAILY_GOAL_MIN,
  DAILY_GOAL_MAX,
  LEVEL_HINTS,
} from "@/lib/profile";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardMeta, CardBody } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";

type Defaults = {
  ageRange: string;
  gender: string;
  englishLevel: string;
  topics: string[];
  dailyGoal: number;
};

export default function ProfileSettingsForm({
  defaults,
}: {
  defaults: Defaults;
}) {
  const router = useRouter();
  const [ageRange, setAgeRange] = useState(defaults.ageRange);
  const [gender, setGender] = useState(defaults.gender);
  const [englishLevel, setEnglishLevel] = useState(defaults.englishLevel);
  const [topics, setTopics] = useState<string[]>(defaults.topics);
  const [dailyGoal, setDailyGoal] = useState(defaults.dailyGoal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // useId ensures unique IDs even if the component mounts twice (Suspense streaming #49).
  const uid = useId();
  const dailyGoalId = `${uid}-daily-goal`;
  const dailyGoalHintId = `${uid}-daily-goal-hint`;

  function markDirty() {
    setSaved(false);
  }

  function toggleTopic(slug: string) {
    markDirty();
    setTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  }

  function decreaseGoal() {
    markDirty();
    setDailyGoal((v) => Math.max(DAILY_GOAL_MIN, v - 1));
  }

  function increaseGoal() {
    markDirty();
    setDailyGoal((v) => Math.min(DAILY_GOAL_MAX, v + 1));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!englishLevel) {
      setLevelError("Please select your English level.");
      return;
    }
    setLevelError(null);

    setSubmitting(true);
    try {
      await putJson("/api/profile", {
        ageRange,
        gender,
        englishLevel,
        topics,
        dailyGoal,
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.message || "Something went wrong. Please try again.");
      } else {
        setError("Network error. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-6)]">
      {/* ── Profile card ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)]">
            Profile
          </h2>
          <CardMeta>
            Your language level and background help us tailor articles.
          </CardMeta>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-[var(--space-4)]">
            <Field
              label="English level"
              required
              error={levelError ?? undefined}
            >
              <Select
                value={englishLevel}
                onChange={(e) => {
                  markDirty();
                  setEnglishLevel(e.target.value);
                  if (e.target.value) setLevelError(null);
                }}
                required
              >
                <option value="">Select a level…</option>
                {ENGLISH_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_HINTS[level] ?? level}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
              <Field label="Age range" hint="Optional">
                <Select
                  value={ageRange}
                  onChange={(e) => {
                    markDirty();
                    setAgeRange(e.target.value);
                  }}
                >
                  <option value="">Prefer not to say</option>
                  {AGE_RANGES.map((range) => (
                    <option key={range} value={range}>
                      {range}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Gender" hint="Optional">
                <Select
                  value={gender}
                  onChange={(e) => {
                    markDirty();
                    setGender(e.target.value);
                  }}
                >
                  <option value="">Prefer not to say</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Reading preferences card ────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)]">
            Reading preferences
          </h2>
          <CardMeta>
            Shape the articles and recommendations we surface for you.
          </CardMeta>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-[var(--space-6)]">
            {/* Daily reading goal stepper */}
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
                  onClick={decreaseGoal}
                  disabled={dailyGoal <= DAILY_GOAL_MIN}
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
                  value={dailyGoal}
                  onChange={(e) => {
                    // Allow mid-type freely; clamp is enforced on blur
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) {
                      setDailyGoal(v);
                      markDirty();
                    }
                  }}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    const clamped = isNaN(v)
                      ? DAILY_GOAL_MIN
                      : Math.max(DAILY_GOAL_MIN, Math.min(DAILY_GOAL_MAX, v));
                    setDailyGoal(clamped);
                  }}
                  aria-describedby={dailyGoalHintId}
                  className="w-[3.5rem] text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Increase daily goal"
                  onClick={increaseGoal}
                  disabled={dailyGoal >= DAILY_GOAL_MAX}
                >
                  <Plus size={16} aria-hidden />
                </Button>
                <span className="text-text-muted text-[length:var(--text-sm)]">
                  {dailyGoal === 1 ? "article" : "articles"} / day
                </span>
              </div>
              {/* Reserve error row height (Field parity) */}
              <p className="min-h-[1.25em]" />
            </div>

            {/* Topics chip group */}
            <div className="flex flex-col gap-[var(--space-2)]">
              <Label>Topics you enjoy</Label>
              <p className="text-text-subtle text-[length:var(--text-xs)]">
                Optional — we&apos;ll surface matching articles in your feed.
              </p>
              <div
                role="group"
                aria-label="Topics you enjoy"
                className="flex flex-wrap gap-[var(--space-2)]"
              >
                {CATEGORIES.map((cat) => {
                  const selected = topics.includes(cat.slug);
                  return (
                    <button
                      key={cat.slug}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTopic(cat.slug)}
                      className={cn(
                        "inline-flex items-center gap-[var(--space-1)]",
                        "min-h-[40px] px-[var(--space-4)]",
                        "text-[length:var(--text-sm)] rounded-[var(--radius-full)]",
                        "border transition-[background-color,border-color,color]",
                        "[transition-duration:var(--duration-fast)]",
                        "outline-none focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
                        selected
                          ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-text border-primary"
                          : "bg-bg-subtle text-text-muted border-border hover:border-border-strong",
                      )}
                    >
                      {selected && (
                        <Check
                          size={14}
                          aria-hidden
                          className="rw-pop shrink-0"
                        />
                      )}
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Form footer ──────────────────────────────────────────────── */}
      {/* Placed inside the form element so it's visually clear what's being saved. */}
      <div
        className="flex items-center gap-[var(--space-4)] flex-wrap"
        style={{
          paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--border)",
          marginTop: "var(--space-2)",
        }}
      >
        <Button type="submit" variant="primary" loading={submitting}>
          Save profile &amp; reading preferences
        </Button>

        {saved && (
          <div
            role="status"
            className="inline-flex items-center gap-[var(--space-2)] text-success-text text-[length:var(--text-sm)]"
          >
            <Check size={16} aria-hidden className="rw-pop shrink-0" />
            Settings saved.
          </div>
        )}

        {error && (
          <p role="alert" className="text-danger-text text-[length:var(--text-sm)]">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
