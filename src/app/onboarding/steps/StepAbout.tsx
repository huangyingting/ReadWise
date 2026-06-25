"use client";

import { AGE_RANGES, GENDERS } from "@/lib/option-registries";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { STEP_TITLES } from "./StepLevel";

export function StepAbout({
  headingRef,
  ageRange,
  gender,
  onAgeChange,
  onGenderChange,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  ageRange: string;
  gender: string;
  onAgeChange: (v: string) => void;
  onGenderChange: (v: string) => void;
}) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[3]}{" "}
        <Badge variant="neutral" className="ml-[var(--space-2)]">Optional</Badge>
      </h2>
      <p className="text-text-subtle text-xs mb-[var(--space-4)]">
        Optional — helps us pick relevant articles for you.
      </p>
      <div className="flex flex-col gap-[var(--space-4)] sm:grid sm:grid-cols-2">
        <Field label="Age range">
          <Select
            value={ageRange}
            onChange={(e) => onAgeChange(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {AGE_RANGES.map((range) => (
              <option key={range} value={range}>
                {range}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender">
          <Select
            value={gender}
            onChange={(e) => onGenderChange(e.target.value)}
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
      <p className="mt-[var(--space-4)] text-text-subtle text-xs">
        These fields are optional and stored in your profile. They are used
        solely to personalise article recommendations. You can update or clear
        them at any time in{" "}
        <strong className="font-medium text-text">Settings</strong>.
      </p>
    </div>
  );
}
