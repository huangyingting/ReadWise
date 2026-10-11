"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import {
  Button,
  Field,
  FormActions,
  Input,
  Stack,
} from "@/components/ui";
import { buttonVariants } from "@/components/ui/Button";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

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
      await accountAdmissionRequest("/api/auth/password/reset", {
        token,
        password,
      });
      setComplete(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The password could not be reset.",
      );
    } finally {
      setPending(false);
    }
  }

  if (complete) {
    return (
      <Stack gap="4">
        <AuthNotice tone="success">
          Your password was changed. Other active sessions were signed out.
        </AuthNotice>
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
        {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
        <Field label="New password" hint="Use 12 to 128 characters." required>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </Field>
        <Field label="Confirm new password" required>
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
            leadingIcon={<KeyRound size={18} aria-hidden />}
          >
            Change password
          </Button>
        </FormActions>
      </Stack>
    </form>
  );
}
