import { requireOnboardedSession } from "@/lib/session";
import { DAILY_GOAL_DEFAULT } from "@/lib/option-registries";
import { getProfile } from "@/features/profile-preferences/repository";
import { parseTopics } from "@/features/profile-preferences/schema";
import {
  Card,
  CardHeader,
  CardTitle,
  CardMeta,
  CardBody,
  Badge,
  PageHeader,
  PageShell,
  Stack,
  Avatar,
} from "@/components/ui";
import ProfileSettingsForm from "./ProfileSettingsForm";
import AccountDangerZone from "@/components/AccountDangerZone";
import PushReminderToggle from "@/components/PushReminderToggle";
import ReminderPreferencesForm from "@/components/ReminderPreferencesForm";
import SettingsThemeRow from "@/components/SettingsThemeRow";
import { settings } from "@/lib/copy/pages";
import { pushConfig } from "@/lib/runtime-config/push";

export const metadata = settings;

export default async function SettingsPage() {
  const session = await requireOnboardedSession("/settings");
  const user = session.user;
  const profile = await getProfile(user.id);

  return (
    <PageShell variant="narrow">
      <PageHeader title="Settings" />

      <Stack gap="6">
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
        <Card>
          <CardHeader>
            <CardTitle level="h2">Appearance</CardTitle>
            <CardMeta>Choose your preferred app theme.</CardMeta>
          </CardHeader>
          <CardBody>
            <SettingsThemeRow />
          </CardBody>
        </Card>

        {/* Account card — read-only, outside the form */}
        <Card>
          <CardHeader>
            <CardTitle level="h2">Account</CardTitle>
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
        {pushConfig.isConfigured() ? (
          <Card>
            <CardHeader>
              <CardTitle level="h2">Notifications</CardTitle>
              <CardMeta>Get reminders when words in your study list are ready to review.</CardMeta>
            </CardHeader>
            <CardBody>
              <PushReminderToggle />
              <ReminderPreferencesForm />
            </CardBody>
          </Card>
        ) : null}

        {/* Privacy & account management */}
        <Card>
          <CardHeader>
            <CardTitle level="h2">Privacy &amp; account</CardTitle>
            <CardMeta>Export your data or permanently delete your account.</CardMeta>
          </CardHeader>
          <CardBody>
            <AccountDangerZone />
          </CardBody>
        </Card>
      </Stack>
    </PageShell>
  );
}
