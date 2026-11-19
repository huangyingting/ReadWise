"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Field, Input, Spinner, Stack } from "@/components/ui";
import { Notice } from "@/components/ui/Notice";
import {
  AuthSubmitButton,
  EmailField,
  NewPasswordFields,
  PASSWORD_MISMATCH_MESSAGE,
  readConfirmedPassword,
} from "@/components/auth/AuthFormParts";
import { useMutation } from "@/hooks/useMutation";
import { clientErrorMessage, postJson } from "@/lib/client-fetch";

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
  const { busy, error, setError, run } = useMutation("The invitation could not be accepted.");

  useEffect(() => {
    let active = true;
    postJson<{ invitation: InvitationView }>("/api/auth/invitation", { token })
      .then((response) => {
        if (active) setInvitation(response.invitation);
      })
      .catch((requestError) => {
        if (active) setError(clientErrorMessage(requestError, "The invitation could not be checked."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, setError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = readConfirmedPassword(form);
    if (password === null) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    await run(
      () =>
        postJson("/api/auth/register", {
          token,
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
        }),
      {
        onSuccess: () => {
          router.push("/onboarding");
          router.refresh();
        },
      },
    );
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
    return <Notice tone="danger">{error}</Notice>;
  }

  if (invitation?.status !== "pending") {
    const descriptions = {
      accepted: "This invitation has already been used.",
      revoked: "This invitation was revoked.",
      expired: "This invitation has expired.",
      invalid: "This invitation is invalid or no longer active.",
    } as const;
    return (
      <Notice tone="danger">
        {descriptions[invitation?.status ?? "invalid"]}
      </Notice>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        <Notice tone="neutral">
          This invitation is for {invitation.maskedEmail}.
        </Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="Name">
          <Input name="name" autoComplete="name" maxLength={120} />
        </Field>
        <EmailField
          label="Invited email"
          hint="Enter the full email address that received this invitation."
        />
        <NewPasswordFields />
        <AuthSubmitButton pending={busy} icon={<UserPlus size={18} aria-hidden />}>
          Accept invitation
        </AuthSubmitButton>
      </Stack>
    </form>
  );
}
