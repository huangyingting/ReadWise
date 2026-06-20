import Image from "next/image";
import { requireOnboardedSession } from "@/lib/session";
import { getProfile, parseTopics, DAILY_GOAL_DEFAULT } from "@/lib/profile";
import {
  Card,
  CardHeader,
  CardMeta,
  CardBody,
  Badge,
} from "@/components/ui";
import ProfileSettingsForm from "./ProfileSettingsForm";
import AccountDangerZone from "@/components/AccountDangerZone";

export const metadata = {
  title: "Settings — ReadWise",
};

export default async function SettingsPage() {
  const session = await requireOnboardedSession("/settings");
  const user = session.user;
  const profile = await getProfile(user.id);

  return (
    <main className="container max-w-[720px]">
      <h1 className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-2xl)] text-text mb-[var(--space-6)]">
        Settings
      </h1>

      {/* ProfileSettingsForm renders Profile + Reading preferences cards */}
      <ProfileSettingsForm
        defaults={{
          ageRange: profile?.ageRange ?? "",
          gender: profile?.gender ?? "",
          englishLevel: profile?.englishLevel ?? "",
          topics: parseTopics(profile?.topics),
          dailyGoal: profile?.dailyGoal ?? DAILY_GOAL_DEFAULT,
        }}
      />

      {/* Account card — read-only, outside the form */}
      <Card className="mt-[var(--space-6)]">
        <CardHeader>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)]">
            Account
          </h2>
          <CardMeta>Your identity and role on ReadWise.</CardMeta>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-[var(--space-4)]">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name ?? "avatar"}
                width={56}
                height={56}
                unoptimized
                className="rounded-full shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-bg-subtle border border-border shrink-0 flex items-center justify-center text-text-muted text-[length:var(--text-lg)] font-semibold">
                {(user.name ?? "?")[0]?.toUpperCase()}
              </div>
            )}
            <div className="flex flex-col gap-[var(--space-1)]">
              <div className="font-semibold text-text">
                {user.name ?? "Unnamed reader"}
              </div>
              <div className="text-text-muted text-[length:var(--text-sm)]">
                {user.email}
              </div>
              <div>
                <Badge variant={user.role === "Admin" ? "primary" : "neutral"}>
                  {user.role}
                </Badge>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Privacy & account management */}
      <Card className="mt-[var(--space-6)]">
        <CardHeader>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)]">
            Privacy &amp; account
          </h2>
          <CardMeta>Export your data or permanently delete your account.</CardMeta>
        </CardHeader>
        <CardBody>
          <AccountDangerZone />
        </CardBody>
      </Card>
    </main>
  );
}
