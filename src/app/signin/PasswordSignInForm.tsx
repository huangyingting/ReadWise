"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Button, Field, FormActions, Input, Stack } from "@/components/ui";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

export default function PasswordSignInForm({
  callbackUrl,
}: {
  callbackUrl: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await accountAdmissionRequest("/api/auth/password/login", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      router.push(callbackUrl);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Sign-in failed.",
      );
    } finally {
      setPending(false);
    }
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
        <Field label="Password" required>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
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
            leadingIcon={<LogIn size={18} aria-hidden />}
          >
            Sign in
          </Button>
        </FormActions>
      </Stack>
    </form>
  );
}
