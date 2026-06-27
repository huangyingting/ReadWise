"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Bookmark, BarChart2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { STORAGE_KEYS } from "@/lib/storage-keys";

const WELCOME_SEEN_KEY = STORAGE_KEYS.WELCOME_SEEN;

const STEPS = [
  {
    icon: BookOpen,
    title: "Read articles at your level",
    description: "Browse hundreds of real English articles, graded to match your CEFR level. Every article adapts to you — font size, spacing, and mode included.",
    href: "/browse",
    cta: "Browse articles",
    color: "var(--primary)",
  },
  {
    icon: Bookmark,
    title: "Save words and review them",
    description: "Tap any word to look it up, then save it to your study list. Spaced repetition helps vocabulary stick.",
    href: "/study",
    cta: "View study list",
    color: "var(--teal)",
  },
  {
    icon: BarChart2,
    title: "Track your progress",
    description: "Every article you read, word you save, and quiz you answer contributes to your streak and mastery score.",
    href: "/progress",
    cta: "See your progress",
    color: "var(--primary-hover)",
  },
];

export default function WelcomeTour({
  landingPath = "/dashboard",
}: {
  /** Where the tour sends the learner when finished/skipped/already-seen. */
  landingPath?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // If already seen, go straight to the learner's landing page.
  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOME_SEEN_KEY)) {
        router.replace(landingPath);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [router, landingPath]);

  function markSeen() {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // Ignore storage errors.
    }
  }

  function handleSkip() {
    markSeen();
    router.push(landingPath);
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      markSeen();
      router.push(landingPath);
    }
  }

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="welcome-tour-container">
      {/* Step dots */}
      <div className="welcome-tour-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((_, i) => (
          <IconButton
            key={i}
            size="sm"
            aria-label={`Go to step ${i + 1}`}
            aria-current={i === step ? "step" : undefined}
            onClick={() => setStep(i)}
            className={cn(
              "welcome-tour-dot",
              i === step ? "welcome-tour-dot--active" : "",
            )}
          />
        ))}
      </div>

      {/* Step card */}
      <div className="welcome-tour-card" aria-live="polite">
        <div
          className="welcome-tour-icon"
          style={{ background: `color-mix(in srgb, ${current.color} 12%, transparent)`, color: current.color }}
        >
          <Icon size={32} aria-hidden />
        </div>

        <h2 className="welcome-tour-title">{current.title}</h2>
        <p className="welcome-tour-description">{current.description}</p>

        <Link href={current.href} className="welcome-tour-link" onClick={markSeen}>
          {current.cta} →
        </Link>
      </div>

      {/* Navigation */}
      <div className="welcome-tour-nav">
        <Button
          variant="ghost"
          size="md"
          onClick={handleSkip}
          className="welcome-tour-skip"
        >
          Skip
        </Button>

        <Button onClick={handleNext} variant="primary" size="md">
          {step < STEPS.length - 1 ? "Next →" : "Start reading →"}
        </Button>
      </div>
    </div>
  );
}
