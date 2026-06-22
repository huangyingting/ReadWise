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
import Avatar from "@/components/ui/Avatar";
import PushReminderToggle from "@/components/PushReminderToggle";
import SettingsThemeRow from "@/components/SettingsThemeRow";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata = {
  title: "Settings — ReadWise",
};

export default async function SettingsPage() {
  const session = await requireOnboardedSession("/settings");
  const user = session.user;
  const profile = await getProfile(user.id);

  return (
    <PageShell variant="narrow">
      <PageHeader title="Settings" />

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

      {/* App theme card — outside the profile form, no submit needed */}
      <Card className="mt-[var(--space-6)]">
        <CardHeader>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)]">
            Appearance
          </h2>
          <CardMeta>Choose your preferred app theme.</CardMeta>
        </CardHeader>
        <CardBody>
          <SettingsThemeRow />
        </CardBody>
      </Card>

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
            <Avatar
              src={user.image}
              name={user.name}
              size={56}
              className="shrink-0"
            />
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

      {/* Notifications card — hidden server-side when VAPID is not configured */}
      {process.env.VAPID_PUBLIC_KEY ? (
        <Card className="mt-[var(--space-6)]">
          <CardHeader>
            <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)]">
              Notifications
            </h2>
            <CardMeta>Get reminders when words in your study list are ready to review.</CardMeta>
          </CardHeader>
          <CardBody>
            <PushReminderToggle />
          </CardBody>
        </Card>
      ) : null}

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
    </PageShell>
  );
}
