import { requireOnboardedSession } from "@/lib/session";
import { defaultLandingPath } from "@/lib/learner-landing";
import WelcomeTour from "./WelcomeTour";
import { welcome } from "@/lib/copy/pages";

export const metadata = welcome;

export default async function WelcomePage() {
  const session = await requireOnboardedSession("/welcome");

  return (
    <div className="welcome-page">
      {/* Visually hidden page h1 — the tour card uses <h2> for its step title */}
      <h1 className="sr-only">Welcome to ReadWise</h1>
      <WelcomeTour landingPath={defaultLandingPath(session.user.role)} />
    </div>
  );
}
