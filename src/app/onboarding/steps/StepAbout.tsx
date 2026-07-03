"use client";

import type { RefObject } from "react";
import { AGE_RANGES, GENDERS } from "@/lib/option-registries";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { STEP_TITLES } from "./StepLevel";

const OPTIONAL_LABEL = "Optional";
const PREFER_NOT_TO_SAY_LABEL = "Prefer not to say";

interface StepAboutProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  ageRange: string;
  gender: string;
  onAgeChange: (v: string) => void;
  onGenderChange: (v: string) => void;
}

interface ProfileSelectFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}

function ProfileSelectField({
  label,
  value,
  options,
  onChange,
}: ProfileSelectFieldProps) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{PREFER_NOT_TO_SAY_LABEL}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function StepAbout({
  headingRef,
  ageRange,
  gender,
  onAgeChange,
  onGenderChange,
}: StepAboutProps) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[3]}{" "}
        <Badge variant="neutral" className="ml-[var(--space-2)]">
          {OPTIONAL_LABEL}
        </Badge>
      </h2>
      <p className="mb-[var(--space-4)] text-text-subtle text-[length:var(--text-xs)]">
        Optional — helps us pick relevant articles for you.
      </p>
      <div className="flex flex-col gap-[var(--space-4)] sm:grid sm:grid-cols-2">
        <ProfileSelectField
          label="Age range"
          value={ageRange}
          options={AGE_RANGES}
          onChange={onAgeChange}
        />
        <ProfileSelectField
          label="Gender"
          value={gender}
          options={GENDERS}
          onChange={onGenderChange}
        />
      </div>
      <p className="mt-[var(--space-4)] text-text-subtle text-[length:var(--text-xs)]">
        These fields are optional and stored in your profile. They are used
        solely to personalise article recommendations. You can update or clear
        them at any time in{" "}
        <strong className="font-medium text-text">Settings</strong>.
      </p>
    </div>
  );
}
