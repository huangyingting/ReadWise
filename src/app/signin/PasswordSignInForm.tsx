"use client";

import { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Field, Input, Stack } from "@/components/ui";
import { Notice } from "@/components/ui/Notice";
import { AuthSubmitButton, EmailField } from "@/components/auth/AuthFormParts";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";

export default function PasswordSignInForm({
  callbackUrl,
}: {
  callbackUrl: string;
}) {
  const router = useRouter();
  const { busy, error, run } = useMutation("Sign-in failed.");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      () =>
        postJson("/api/auth/password/login", {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      {
        onSuccess: () => {
          router.push(callbackUrl);
          router.refresh();
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <EmailField />
        <Field label="Password" required>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </Field>
        <AuthSubmitButton pending={busy} icon={<LogIn size={18} aria-hidden />}>
          Sign in
        </AuthSubmitButton>
      </Stack>
    </form>
  );
}
