"use client";

import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";
import {
  Button,
  Field,
  FormActions,
  Input,
  Stack,
} from "@/components/ui";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

export default function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await accountAdmissionRequest("/api/auth/password/forgot", {
        email: String(form.get("email") ?? ""),
      });
      setComplete(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The reset request could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  if (complete) {
    return (
      <AuthNotice tone="success">
        If a password account exists for that email, a reset link is on its
        way.
      </AuthNotice>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
        <Field label="Email" required>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />
        </Field>
        <FormActions align="stretch">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={pending}
            leadingIcon={<Mail size={18} aria-hidden />}
          >
            Send reset link
          </Button>
        </FormActions>
      </Stack>
    </form>
  );
}
