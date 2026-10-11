import type { Metadata } from "next";
import { AuthNotice, AuthShell } from "@/components/auth/AuthShell";
import { accountAdmissionMode } from "@/lib/account-admission";
import InvitationRegistrationForm from "./InvitationRegistrationForm";

export const metadata: Metadata = {
  title: "Accept invitation",
  description: "Accept a ReadWise account invitation.",
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AuthShell
      title="Accept your invitation"
      description="Create your password to finish joining ReadWise."
    >
      {accountAdmissionMode() === "invitation-only" ? (
        <InvitationRegistrationForm token={token} />
      ) : (
        <AuthNotice tone="neutral">
          This deployment currently uses public registration. Create an account
          from the registration page instead.
        </AuthNotice>
      )}
    </AuthShell>
  );
}
