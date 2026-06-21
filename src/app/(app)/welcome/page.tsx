import { requireOnboardedSession } from "@/lib/session";
import WelcomeTour from "./WelcomeTour";

export const metadata = {
  title: "Welcome to ReadWise",
};

export default async function WelcomePage() {
  await requireOnboardedSession("/welcome");

  return (
    <div className="welcome-page">
      <WelcomeTour />
    </div>
  );
}
