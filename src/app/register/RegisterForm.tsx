"use client";

import { FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import {
  Button,
  Field,
  FormActions,
  Input,
  Stack,
} from "@/components/ui";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

export default function RegisterForm() {
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
      await accountAdmissionRequest("/api/auth/register", {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password,
      });
      setComplete(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Registration could not be started.",
      );
    } finally {
      setPending(false);
    }
  }

  if (complete) {
    return (
      <AuthNotice tone="success">
        Check your email for a verification link. The link expires in 24 hours.
      </AuthNotice>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
        <Field label="Name">
          <Input
            name="name"
            type="text"
            autoComplete="name"
            maxLength={120}
          />
        </Field>
        <Field label="Email" required>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />
        </Field>
        <Field
          label="Password"
          hint="Use 12 to 128 characters."
          required
        >
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
            Create account
          </Button>
        </FormActions>
      </Stack>
    </form>
  );
}
