import type { Metadata } from "next";
import { AuthNotice, AuthShell } from "@/components/auth/AuthShell";
import { accountAdmissionMode } from "@/lib/account-admission";
import RegisterForm from "./RegisterForm";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a ReadWise account.",
};

export default function RegisterPage() {
  const isPublic = accountAdmissionMode() === "public";
  return (
    <AuthShell
      title="Create your account"
      description="Start reading with an email and password."
    >
      {isPublic ? (
        <RegisterForm />
      ) : (
        <AuthNotice tone="neutral">
          ReadWise is currently invitation-only. Use the personal invitation
          link sent by an administrator.
        </AuthNotice>
      )}
    </AuthShell>
  );
}
