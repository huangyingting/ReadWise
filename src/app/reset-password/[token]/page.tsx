import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Choose a new ReadWise password.",
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AuthShell
      title="Choose a new password"
      description="This link can be used once and expires after one hour."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
