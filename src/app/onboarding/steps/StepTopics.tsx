"use client";

import { TopicSelector } from "@/features/profile-preferences";
import { STEP_TITLES } from "./StepLevel";

interface StepTopicsProps {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  topics: string[];
  toggleTopic: (slug: string) => void;
}

export function StepTopics({
  headingRef,
  topics,
  toggleTopic,
}: StepTopicsProps) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[2]}
      </h2>
      <p className="mb-[var(--space-4)] text-text-subtle text-[length:var(--text-xs)]">
        Pick any that interest you — or none.
      </p>
      <TopicSelector topics={topics} onToggle={toggleTopic} />
    </div>
  );
}
