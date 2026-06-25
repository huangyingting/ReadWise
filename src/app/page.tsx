import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
  Sparkles,
  GraduationCap,
  Headphones,
  Compass,
  BookOpen,
  BrainCircuit,
  TrendingUp,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { Badge, CefrBadge, buttonVariants } from "@/components/ui";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MockReaderCard } from "@/components/marketing/MockReaderCard";
import { FeatureCard } from "@/components/marketing/FeatureCard";
import { StepCard } from "@/components/marketing/StepCard";
import { Reveal } from "@/components/marketing/Reveal";
import { landing } from "@/lib/copy/pages";

export const metadata: Metadata = landing;

const CONTAINER =
  "mx-auto max-w-[1200px] px-[clamp(var(--space-6),5vw,var(--space-8))]";

const SOURCES = ["NBC News", "National Geographic", "Time", "HuffPost"];

const FEATURES = [
  {
    icon: <Sparkles size={20} />,
    title: "Instant answers, right in the text",
    body: "Select any word for an instant dictionary definition — phonetics, part of speech, examples. Tap a sentence for a full article translation in your language. No tab-switching. No flow broken.",
    features: [
      "Word-by-word dictionary lookup",
      "Multi-language article translation (Spanish, French, Chinese, and more)",
    ],
    accent: "primary" as const,
  },
  {
    icon: <GraduationCap size={20} />,
    title: "Turn every article into a lesson",
    body: "AI extracts the most useful vocabulary from each article. Save words to your personal study list. Then test your understanding with a comprehension quiz — all without leaving the reader.",
    features: [
      "AI-extracted vocabulary + personal study list",
      "Per-article comprehension quizzes",
    ],
    accent: "primary" as const,
  },
  {
    icon: <Headphones size={20} />,
    title: "Hear it. Understand it. Own it.",
    body: "Natural text-to-speech narration highlights each word as it's spoken — so you see and hear English simultaneously. Articles are automatically graded A1–C2, and your feed surfaces content matched to your level.",
    features: [
      "TTS narration with word-by-word highlight sync",
      "Automatic CEFR difficulty levels (A1–C2)",
      'Personalized "Picks" feed based on your level + topics',
    ],
    accent: "teal" as const,
  },
];

const STEPS = [
  {
    step: "1",
    icon: <Compass size={24} />,
    title: "Pick your article",
    body: "Browse by category — science, world news, culture — or let Picks surface articles at exactly your English level. Every source is real. Nothing is dumbed down.",
  },
  {
    step: "2",
    icon: <BookOpen size={24} />,
    title: "Read with superpowers",
    body: "Tap any word for its definition. Switch to your language for the full translation. Hear the article spoken aloud with word-by-word highlighting. Difficult passages become clear without breaking your flow.",
  },
  {
    step: "3",
    icon: <BrainCircuit size={24} />,
    title: "Practice what you read",
    body: "Review the vocabulary the AI flagged for you, save the words you want to master, and take a quick quiz. Learning happens in context — not from a flashcard list invented by someone else.",
  },
  {
    step: "4",
    icon: <TrendingUp size={24} />,
    title: "Watch your progress grow",
    body: "ReadWise tracks how far you've read in every article — even across sessions. Your dashboard shows your reading history and saved words so you can see real growth over time.",
  },
];

const LEVELS: { level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"; phrase: string }[] =
  [
    { level: "A1", phrase: "Absolute beginner" },
    { level: "A2", phrase: "Elementary" },
    { level: "B1", phrase: "Intermediate" },
    { level: "B2", phrase: "Upper-intermediate" },
    { level: "C1", phrase: "Advanced" },
    { level: "C2", phrase: "Proficient" },
  ];

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const signedIn = Boolean(session?.user);

  const primaryHref = signedIn ? "/dashboard" : "/signin";
  const primaryLabel = signedIn ? (
    <>Continue Reading <span aria-hidden="true">→</span></>
  ) : "Get Started — It's Free";

  return (
    <>
      <MarketingHeader signedIn={signedIn} />

      <main id="main-content">
        {/* Hero */}
        <section
          className="relative overflow-hidden py-[var(--space-10)] md:py-[var(--space-12)]"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 70% 40%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 70%), radial-gradient(ellipse 40% 50% at 80% 80%, color-mix(in srgb, var(--teal) 8%, transparent), transparent 60%), var(--bg)",
          }}
        >
          <div
            className={`${CONTAINER} grid items-center gap-[var(--space-9)] lg:grid-cols-2`}
          >
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
              <Badge
                variant="primary"
                uppercase
                className="rw-fade-up"
                style={{ animationDelay: "0ms" }}
              >
                AI-Powered English Learning
              </Badge>

              <h1
                className="rw-fade-up text-gradient-brand mt-[var(--space-5)] font-[family-name:var(--font-display)] text-[length:clamp(var(--text-3xl),5vw,var(--text-4xl))] font-bold leading-[var(--leading-tight)]"
                style={{ animationDelay: "80ms" }}
              >
                Real news. Real English. Real progress.
              </h1>

              <p
                className="rw-fade-up mt-[var(--space-5)] max-w-[44ch] text-[length:var(--text-lg)] leading-[var(--leading-normal)] text-text-muted"
                style={{ animationDelay: "160ms" }}
              >
                Learn English from real articles by NBC News, National Geographic,
                Time, and more — with an AI toolkit that teaches as you read, not
                just translates.
              </p>

              <div
                className="rw-fade-up mt-[var(--space-7)] flex flex-wrap items-center justify-center gap-[var(--space-4)] lg:justify-start"
                style={{ animationDelay: "240ms" }}
              >
                <Link
                  href={primaryHref}
                  className={buttonVariants({ variant: "primary", size: "lg" })}
                >
                  {primaryLabel}
                </Link>
                {!signedIn && (
                  <Link
                    href="/signin"
                    className={buttonVariants({ variant: "ghost", size: "lg" })}
                  >
                    Sign In
                  </Link>
                )}
              </div>
            </div>

            <div className="rw-fade-up" style={{ animationDelay: "320ms" }}>
              <MockReaderCard />
            </div>
          </div>
        </section>

        {/* Sources trust strip */}
        <section className="border-t border-border py-[var(--space-6)]">
          <div
            className={`${CONTAINER} flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-3)] overflow-x-auto`}
          >
            <h2 className="sr-only">Trusted sources</h2>
            <p className="italic text-[length:var(--text-sm)] text-text-subtle">
              Real articles from:
            </p>
            {SOURCES.map((name) => (
              <Badge key={name} variant="neutral">
                {name}
              </Badge>
            ))}
          </div>
        </section>

        {/* Feature Showcase */}
        <section className="py-[var(--space-12)]">
          <div className={CONTAINER}>
            <Reveal className="mx-auto max-w-[52ch] text-center">
              <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-text">
                Everything you need to read and learn
              </h2>
              <p className="mt-[var(--space-3)] text-[length:var(--text-lg)] text-text-muted">
                One reading session. A full learning toolkit.
              </p>
            </Reveal>

            <div className="mt-[var(--space-9)] grid gap-[var(--space-6)] md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature, i) => (
                <Reveal
                  key={feature.title}
                  style={{ transitionDelay: `${i * 80}ms` }}
                  className="h-full"
                >
                  <FeatureCard
                    icon={feature.icon}
                    title={feature.title}
                    body={feature.body}
                    features={feature.features}
                    accent={feature.accent}
                  />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="bg-bg-subtle py-[var(--space-12)]">
          <div className={CONTAINER}>
            <Reveal className="mx-auto max-w-[56ch] text-center">
              <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-text">
                From article to fluency in four steps
              </h2>
              <p className="mt-[var(--space-3)] text-[length:var(--text-lg)] text-text-muted">
                ReadWise structures every session so you always know what to do
                next.
              </p>
            </Reveal>

            <div className="mt-[var(--space-9)] flex flex-col gap-[var(--space-7)] lg:flex-row lg:gap-[var(--space-6)]">
              {STEPS.map((s, i) => (
                <Reveal
                  key={s.step}
                  className="flex flex-1"
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <StepCard
                    step={s.step}
                    icon={s.icon}
                    title={s.title}
                    body={s.body}
                    isLast={i === STEPS.length - 1}
                  />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* CEFR / For Every Level */}
        <section className="bg-bg py-[var(--space-11)]">
          <div className={CONTAINER}>
            <Reveal className="mx-auto max-w-[56ch] text-center">
              <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-text">
                For every learner, at every level
              </h2>
              <p className="mt-[var(--space-3)] text-[length:var(--text-lg)] text-text-muted">
                Whether you&apos;re decoding your first English newspaper or
                polishing C1 business writing, ReadWise meets you exactly where you
                are.
              </p>
            </Reveal>

            <ul className="mt-[var(--space-9)] flex flex-wrap justify-center gap-[var(--space-5)]">
              {LEVELS.map(({ level, phrase }, i) => (
                <Reveal
                  key={level}
                  className="flex flex-col items-center gap-[var(--space-2)]"
                  style={{ transitionDelay: `${i * 40}ms` }}
                >
                  <CefrBadge level={level} />
                  <span className="text-[length:var(--text-sm)] text-text-subtle">
                    {phrase}
                  </span>
                </Reveal>
              ))}
            </ul>

            <Reveal className="mx-auto mt-[var(--space-7)] max-w-[56ch] text-center">
              <p className="text-[length:var(--text-base)] text-text-muted">
                During onboarding, you tell ReadWise your current level and the
                topics you care about. The app filters and sorts every article so
                the right content finds you — not the other way around. Reassess any
                time in Settings.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Final CTA band */}
        <section
          className="py-[var(--space-12)]"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div className={`${CONTAINER} flex flex-col items-center text-center`}>
            <h2 className="mx-auto max-w-[48ch] font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-on-primary">
              Start reading. Start learning. Today.
            </h2>
            <p
              className="mx-auto mt-[var(--space-4)] max-w-[48ch] text-[length:var(--text-lg)]"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Free to join. Real articles. An AI toolkit that grows with your
              English. No textbooks. No drills. Just reading.
            </p>
            <div className="mt-[var(--space-7)]">
              <Link
                href={primaryHref}
                className={buttonVariants({ variant: "secondary", size: "lg" })}
              >
                {primaryLabel}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
