"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { putJson } from "@/lib/client-fetch";
import {
  AGE_RANGES,
  ENGLISH_LEVELS,
  GENDERS,
  LEVEL_HINTS,
} from "@/lib/option-registries";
import {
  TopicSelector,
  DailyGoalStepper,
} from "@/features/profile-preferences";
import { useMutation } from "@/hooks/useMutation";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardMeta,
  CardBody,
  Field,
  FormActions,
  Label,
  Select,
} from "@/components/ui";

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
  const [levelError, setLevelError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useMutation("Network error. Please try again.");

  function markDirty() {
    setSaved(false);
  }

  function toggleTopic(slug: string) {
    markDirty();
    setTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  }


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);

    if (!englishLevel) {
      setLevelError("Please select your English level.");
      return;
    }
    setLevelError(null);

    await run(async () => {
      await putJson("/api/profile", {
        ageRange,
        gender,
        englishLevel,
        topics,
        dailyGoal,
      });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-6)]">
      {/* ── Profile card ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle level="h2">Profile</CardTitle>
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
          <CardTitle level="h2">Reading preferences</CardTitle>
          <CardMeta>
            Shape the articles and recommendations we surface for you.
          </CardMeta>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-[var(--space-6)]">
            {/* Daily reading goal stepper */}
            <DailyGoalStepper
              value={dailyGoal}
              onChange={(v) => {
                setDailyGoal(v);
                markDirty();
              }}
            />

            {/* Topics chip group */}
            <div className="flex flex-col gap-[var(--space-2)]">
              <Label>Topics you enjoy</Label>
              <p className="text-text-subtle text-[length:var(--text-xs)]">
                Optional — we&apos;ll surface matching articles in your feed.
              </p>
              <TopicSelector topics={topics} onToggle={toggleTopic} />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Form footer ──────────────────────────────────────────────── */}
      {/* Placed inside the form element so it's visually clear what's being saved. */}
      <FormActions align="start" className="mt-[var(--space-2)] border-t border-border">
        <Button type="submit" variant="primary" loading={busy}>
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
      </FormActions>
    </form>
  );
}
