import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getProfile, isOnboarded, parseTopics } from "@/lib/profile";
import OnboardingForm from "./OnboardingForm";

export const metadata = {
  title: "Welcome — ReadWise",
};

export default async function OnboardingPage() {
  const session = await requireSession("/onboarding");
  const profile = await getProfile(session.user.id);

  if (isOnboarded(profile)) {
    redirect("/dashboard");
  }

  return (
    <main className="container">
      <h1>Welcome to ReadWise</h1>
      <p className="muted">
        Answer a few quick questions so we can tailor articles to your level and
        interests. You can change these later.
      </p>
      <OnboardingForm
        defaults={{
          ageRange: profile?.ageRange ?? "",
          gender: profile?.gender ?? "",
          englishLevel: profile?.englishLevel ?? "",
          topics: parseTopics(profile?.topics),
        }}
      />
    </main>
  );
}
