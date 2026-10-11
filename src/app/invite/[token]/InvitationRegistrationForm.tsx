"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import {
  Button,
  Field,
  FormActions,
  Input,
  Spinner,
  Stack,
} from "@/components/ui";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

type InvitationView = {
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid";
  maskedEmail: string | null;
  expiresAt: string | null;
};

export default function InvitationRegistrationForm({
  token,
}: {
  token: string;
}) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    accountAdmissionRequest<{ invitation: InvitationView }>(
      "/api/auth/invitation",
      { token },
    )
      .then((response) => {
        if (active) setInvitation(response.invitation);
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "The invitation could not be checked.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      await accountAdmissionRequest("/api/auth/register", {
        token,
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password,
      });
      router.push("/onboarding");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The invitation could not be accepted.",
      );
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-text-muted">
        <Spinner size={18} />
        Checking invitation…
      </div>
    );
  }

  if (error && !invitation) {
    return <AuthNotice tone="error">{error}</AuthNotice>;
  }

  if (invitation?.status !== "pending") {
    const descriptions = {
      accepted: "This invitation has already been used.",
      revoked: "This invitation was revoked.",
      expired: "This invitation has expired.",
      invalid: "This invitation is invalid or no longer active.",
    } as const;
    return (
      <AuthNotice tone="error">
        {descriptions[invitation?.status ?? "invalid"]}
      </AuthNotice>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        <AuthNotice tone="neutral">
          This invitation is for {invitation.maskedEmail}.
        </AuthNotice>
        {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
        <Field label="Name">
          <Input name="name" autoComplete="name" maxLength={120} />
        </Field>
        <Field
          label="Invited email"
          hint="Enter the full email address that received this invitation."
          required
        >
          <Input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />
        </Field>
        <Field label="Password" hint="Use 12 to 128 characters." required>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </Field>
        <Field label="Confirm password" required>
          <Input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </Field>
        <FormActions align="stretch">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={pending}
            leadingIcon={<UserPlus size={18} aria-hidden />}
          >
            Accept invitation
          </Button>
        </FormActions>
      </Stack>
    </form>
  );
}
