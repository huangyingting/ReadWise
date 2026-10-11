import type { ReactNode } from "react";
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
  navItemVariants,
} from "@/components/ui";
import ProfileSettingsForm from "./ProfileSettingsForm";
import RetakePlacement from "./RetakePlacement";
import AccountDangerZone from "@/components/AccountDangerZone";
import ClearLearningMemory from "@/components/ClearLearningMemory";
import PushReminderToggle from "@/components/PushReminderToggle";
import ReminderPreferencesForm from "@/components/ReminderPreferencesForm";
import SettingsThemeRow from "@/components/SettingsThemeRow";
import { settings } from "@/lib/copy/pages";
import { pushConfig } from "@/lib/runtime-config/push";
import { seedLevelForProfile } from "@/lib/learning/placement";
import { listAuthenticationMethods } from "@/lib/account-admission";
import { getConfiguredProviders } from "@/lib/auth/providers";
import AuthenticationSettings from "./AuthenticationSettings";

export const metadata = settings;

type Profile = Awaited<ReturnType<typeof getProfile>>;
type SettingsUser = Awaited<ReturnType<typeof requireOnboardedSession>>["user"];

function getProfileDefaults(profile: Profile) {
  return {
    ageRange: profile?.ageRange ?? "",
    gender: profile?.gender ?? "",
    englishLevel: profile?.englishLevel ?? "",
    topics: parseTopics(profile?.topics),
    dailyGoal: profile?.dailyGoal ?? DAILY_GOAL_DEFAULT,
    goalPath: profile?.goalPath ?? "",
  };
}

function AppearanceCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">Appearance</CardTitle>
        <CardMeta>Choose your preferred app theme.</CardMeta>
      </CardHeader>
      <CardBody>
        <SettingsThemeRow />
      </CardBody>
    </Card>
  );
}

function AccountCard({ user }: { user: SettingsUser }) {
  return (
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
  );
}

function NotificationsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">Notifications</CardTitle>
        <CardMeta>
          Get reminders when words in your study list are ready to review.
        </CardMeta>
      </CardHeader>
      <CardBody>
        <PushReminderToggle />
        <ReminderPreferencesForm />
      </CardBody>
    </Card>
  );
}

function PrivacyAccountCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">Privacy &amp; account</CardTitle>
        <CardMeta>
          Manage your learning memory, export your data, or permanently delete
          your account.
        </CardMeta>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col gap-[var(--space-4)]">
          <ClearLearningMemory />
          <div className="border-t border-border pt-[var(--space-4)]">
            <AccountDangerZone />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

const SETTINGS_SECTIONS = {
  profile: { id: "profile", label: "Profile & reading" },
  placement: { id: "placement", label: "Reading placement" },
  appearance: { id: "appearance", label: "Appearance" },
  account: { id: "account", label: "Account" },
  signIn: { id: "sign-in", label: "Sign-in methods" },
  notifications: { id: "notifications", label: "Notifications" },
  privacy: { id: "privacy", label: "Privacy & account" },
} as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[keyof typeof SETTINGS_SECTIONS];

/**
 * In-page index for the settings cards (lg+ only). Plain anchor links, so it
 * works without JS and keeps native Tab/Enter behaviour.
 */
function SettingsIndex({ sections }: { sections: readonly SettingsSection[] }) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-[calc(var(--header-height)+var(--space-4))] flex flex-col gap-px"
    >
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={navItemVariants({ className: "w-full" })}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

function SettingsAnchor({
  section,
  children,
}: {
  section: SettingsSection;
  children: ReactNode;
}) {
  return (
    <div
      id={section.id}
      className="scroll-mt-[calc(var(--header-height)+var(--space-4))]"
    >
      {children}
    </div>
  );
}

export default async function SettingsPage() {
  const session = await requireOnboardedSession("/settings");
  const user = session.user;
  const [profile, authenticationMethods] = await Promise.all([
    getProfile(user.id),
    listAuthenticationMethods(user.id),
  ]);
  const showNotifications = pushConfig.isConfigured();
  const sections = Object.values(SETTINGS_SECTIONS).filter(
    (section) =>
      section.id !== SETTINGS_SECTIONS.notifications.id || showNotifications,
  );

  return (
    <PageShell>
      <div className="grid gap-[var(--space-6)] lg:grid-cols-[var(--rail-w)_minmax(0,var(--container-narrow))] lg:justify-center">
        <div className="hidden lg:block">
          <SettingsIndex sections={sections} />
        </div>

        <div className="min-w-0">
          <PageHeader title="Settings" />

          <Stack gap="4">
            {/* ProfileSettingsForm renders Profile + Reading preferences cards */}
            <SettingsAnchor section={SETTINGS_SECTIONS.profile}>
              <ProfileSettingsForm defaults={getProfileDefaults(profile)} />
            </SettingsAnchor>

            {/* Reading placement (#806) — retake affordance posts attempt="retake" */}
            <SettingsAnchor section={SETTINGS_SECTIONS.placement}>
              <RetakePlacement seedLevel={seedLevelForProfile(profile?.englishLevel)} />
            </SettingsAnchor>

            {/* App theme card — outside the profile form, no submit needed */}
            <SettingsAnchor section={SETTINGS_SECTIONS.appearance}>
              <AppearanceCard />
            </SettingsAnchor>

            {/* Account card — read-only, outside the form */}
            <SettingsAnchor section={SETTINGS_SECTIONS.account}>
              <AccountCard user={user} />
            </SettingsAnchor>

            <SettingsAnchor section={SETTINGS_SECTIONS.signIn}>
              <AuthenticationSettings
                initialHasPassword={authenticationMethods.hasPassword}
                linkedProviders={authenticationMethods.providers}
                configuredProviders={getConfiguredProviders()}
              />
            </SettingsAnchor>

            {/* Notifications card — hidden server-side when VAPID is not configured */}
            {showNotifications ? (
              <SettingsAnchor section={SETTINGS_SECTIONS.notifications}>
                <NotificationsCard />
              </SettingsAnchor>
            ) : null}

            {/* Privacy & account management */}
            <SettingsAnchor section={SETTINGS_SECTIONS.privacy}>
              <PrivacyAccountCard />
            </SettingsAnchor>
          </Stack>
        </div>
      </div>
    </PageShell>
  );
}
