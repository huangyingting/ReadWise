"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Stack } from "@/components/ui";
import { buttonVariants } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import {
  AuthSubmitButton,
  NewPasswordFields,
  PASSWORD_MISMATCH_MESSAGE,
  readConfirmedPassword,
} from "@/components/auth/AuthFormParts";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";

export default function ResetPasswordForm({ token }: { token: string }) {
  const { busy, error, setError, run } = useMutation("The password could not be reset.");
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = readConfirmedPassword(new FormData(event.currentTarget));
    if (password === null) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    await run(() => postJson("/api/auth/password/reset", { token, password }), {
      onSuccess: () => setComplete(true),
    });
  }

  if (complete) {
    return (
      <Stack gap="4">
        <Notice tone="success">
          Your password was changed. Other active sessions were signed out.
        </Notice>
        <Link
          href="/signin"
          className={buttonVariants({
            variant: "primary",
            size: "lg",
            className: "w-full",
          })}
        >
          Sign in
        </Link>
      </Stack>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <NewPasswordFields label="New password" confirmLabel="Confirm new password" />
        <AuthSubmitButton pending={busy} icon={<KeyRound size={18} aria-hidden />}>
          Change password
        </AuthSubmitButton>
      </Stack>
    </form>
  );
}
