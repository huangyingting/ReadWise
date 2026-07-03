import { requireOnboardedSession } from "@/lib/session";
import { defaultLandingPath } from "@/lib/learner-landing";
import { prisma } from "@/lib/prisma";
import { getProfile } from "@/lib/profile";
import { seedLevelForProfile } from "@/lib/learning/placement";
import WelcomeTour from "./WelcomeTour";
import WelcomePlacement from "./WelcomePlacement";
import { welcome } from "@/lib/copy/pages";

export const metadata = welcome;

async function getWelcomePlacementState(userId: string) {
  const [profile, placement] = await Promise.all([
    getProfile(userId),
    prisma.placementResult.findUnique({
      where: { userId },
      select: { id: true },
    }),
  ]);

  return {
    hasPlacement: Boolean(placement),
    seedLevel: seedLevelForProfile(profile?.englishLevel),
  };
}

export default async function WelcomePage() {
  const session = await requireOnboardedSession("/welcome");

  // Show the one-time reading placement (#806) only when the learner has no
  // PlacementResult yet. Skippable + self-dismissing, so it never blocks the
  // welcome tour.
  const { hasPlacement, seedLevel } = await getWelcomePlacementState(session.user.id);

  return (
    <div className="welcome-page">
      {/* Visually hidden page h1 — the tour card uses <h2> for its step title */}
      <h1 className="sr-only">Welcome to ReadWise</h1>
      {hasPlacement ? null : <WelcomePlacement seedLevel={seedLevel} />}
      <WelcomeTour landingPath={defaultLandingPath(session.user.role)} />
    </div>
  );
}
