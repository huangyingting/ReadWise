/**
 * Landing page content — static copy arrays for section components (REF-059).
 *
 * Keeping content separate from layout makes copy review straightforward and
 * is the first step toward localization readiness. Icon components are stored
 * as references so this module contains no JSX.
 */
import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  GraduationCap,
  Headphones,
  Compass,
  BookOpen,
  BrainCircuit,
  TrendingUp,
} from "lucide-react";
import type { FeatureAccent } from "@/components/marketing/FeatureCard";

export const CONTAINER =
  "mx-auto max-w-[var(--marketing-container-w)] px-[clamp(var(--space-6),5vw,var(--space-8))]";

export const SOURCES = ["NBC News", "National Geographic", "Time", "HuffPost"] as const;

export interface FeatureItem {
  Icon: LucideIcon;
  iconSize: number;
  title: string;
  body: string;
  features: string[];
  accent: FeatureAccent;
}

export const FEATURES: FeatureItem[] = [
  {
    Icon: Sparkles,
    iconSize: 20,
    title: "Instant answers, right in the text",
    body: "Select any word for an instant dictionary definition — phonetics, part of speech, examples. Tap a sentence for a full article translation in your language. No tab-switching. No flow broken.",
    features: [
      "Word-by-word dictionary lookup",
      "Multi-language article translation (Spanish, French, Chinese, and more)",
    ],
    accent: "primary",
  },
  {
    Icon: GraduationCap,
    iconSize: 20,
    title: "Turn every article into a lesson",
    body: "AI extracts the most useful vocabulary from each article. Save words to your personal study list. Then test your understanding with a comprehension quiz — all without leaving the reader.",
    features: [
      "AI-extracted vocabulary + personal study list",
      "Per-article comprehension quizzes",
    ],
    accent: "primary",
  },
  {
    Icon: Headphones,
    iconSize: 20,
    title: "Hear it. Understand it. Own it.",
    body: "Natural text-to-speech narration highlights each word as it's spoken — so you see and hear English simultaneously. Articles are automatically graded A1–C2, and your feed surfaces content matched to your level.",
    features: [
      "TTS narration with word-by-word highlight sync",
      "Automatic CEFR difficulty levels (A1–C2)",
      'Personalized "Picks" feed based on your level + topics',
    ],
    accent: "teal",
  },
];

export interface StepItem {
  step: string;
  Icon: LucideIcon;
  iconSize: number;
  title: string;
  body: string;
}

export const STEPS: StepItem[] = [
  {
    step: "1",
    Icon: Compass,
    iconSize: 24,
    title: "Pick your article",
    body: "Browse by category — science, world news, culture — or let Picks surface articles at exactly your English level. Every source is real. Nothing is dumbed down.",
  },
  {
    step: "2",
    Icon: BookOpen,
    iconSize: 24,
    title: "Read with superpowers",
    body: "Tap any word for its definition. Switch to your language for the full translation. Hear the article spoken aloud with word-by-word highlighting. Difficult passages become clear without breaking your flow.",
  },
  {
    step: "3",
    Icon: BrainCircuit,
    iconSize: 24,
    title: "Practice what you read",
    body: "Review the vocabulary the AI flagged for you, save the words you want to master, and take a quick quiz. Learning happens in context — not from a flashcard list invented by someone else.",
  },
  {
    step: "4",
    Icon: TrendingUp,
    iconSize: 24,
    title: "Watch your progress grow",
    body: "ReadWise tracks how far you've read in every article — even across sessions. Your dashboard shows your reading history and saved words so you can see real growth over time.",
  },
];

export const LEVELS: { level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"; phrase: string }[] = [
  { level: "A1", phrase: "Absolute beginner" },
  { level: "A2", phrase: "Elementary" },
  { level: "B1", phrase: "Intermediate" },
  { level: "B2", phrase: "Upper-intermediate" },
  { level: "C1", phrase: "Advanced" },
  { level: "C2", phrase: "Proficient" },
];
