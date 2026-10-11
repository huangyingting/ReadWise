import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import VerifyEmailState from "./VerifyEmailState";

export const metadata: Metadata = {
  title: "Verify email",
  description: "Verify your ReadWise email address.",
};

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AuthShell
      title="Verify your email"
      description="We are finishing your ReadWise account."
    >
      <VerifyEmailState token={token} />
    </AuthShell>
  );
}
