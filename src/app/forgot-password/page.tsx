import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a ReadWise password reset link.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="We will send a single-use reset link if the account exists."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
