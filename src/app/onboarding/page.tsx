import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getProfile, isOnboarded } from "@/features/profile-preferences/repository";
import { parseTopics } from "@/features/profile-preferences/schema";
import { defaultLandingPath } from "@/lib/learner-landing";
import { Wordmark } from "@/components/marketing/Wordmark";
import ThemeToggle from "@/components/shell/ThemeToggle";
import OnboardingForm from "./OnboardingForm";
import { onboarding } from "@/lib/copy/pages";

export const metadata = onboarding;

export default async function OnboardingPage() {
  const session = await requireSession("/onboarding");
  const profile = await getProfile(session.user.id);

  if (isOnboarded(profile)) {
    redirect(defaultLandingPath(session.user.role));
  }

  return (
    <main className="min-h-[100dvh] flex flex-col bg-bg">
      {/* Minimal top bar — same family as sign-in */}
      <div className="h-16 flex items-center justify-between max-w-[var(--container-listing)] w-full mx-auto px-[var(--space-6)]">
        <Wordmark />
        <ThemeToggle />
      </div>

      {/* Centered content column */}
      <div className="max-w-[560px] mx-auto w-full px-[var(--space-4)] py-[var(--space-8)]">
        <h1 className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-3xl)] text-text leading-[var(--leading-snug)]">
          Welcome to ReadWise
        </h1>
        <p className="mt-[var(--space-2)] text-text-muted text-[length:var(--text-base)]">
          Answer a few quick questions so we can tailor articles to your level
          and interests. You can change these anytime.
        </p>
        <OnboardingForm
          defaults={{
            ageRange: profile?.ageRange ?? "",
            gender: profile?.gender ?? "",
            englishLevel: profile?.englishLevel ?? "",
            topics: parseTopics(profile?.topics),
          }}
        />
      </div>
    </main>
  );
}
