"use client";

/**
 * Reading level lock for an assignment (#1303): "Student choice" (unlocked)
 * or a specific level every student reads and is quizzed at. Hidden for
 * single-level articles.
 */

import { Field, Select } from "@/components/ui";
import { readingLevelLabel, type ReadingLevelKey } from "@/lib/article-levels/levels";

export const STUDENT_CHOICE = "";

export default function ReadingLevelLockField({
  levelOptions,
  value,
  onChange,
}: {
  levelOptions: ReadingLevelKey[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (levelOptions.length === 0) return null;
  return (
    <Field label="Reading level" hint="Lock a level for assessment parity, or let students choose.">
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={STUDENT_CHOICE}>Student choice</option>
        {levelOptions.map((level) => (
          <option key={level} value={level}>
            {readingLevelLabel(level)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
