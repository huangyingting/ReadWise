"use client";

import type { ReactNode } from "react";
import { Button, Field, FormActions, Input } from "@/components/ui";

export const PASSWORD_MISMATCH_MESSAGE = "Passwords do not match.";

/**
 * The new password from a form with `password` + `confirmPassword` fields, or
 * null when the two don't match.
 */
export function readConfirmedPassword(form: FormData): string | null {
  const password = String(form.get("password") ?? "");
  return password === String(form.get("confirmPassword") ?? "") ? password : null;
}

/** Email input used by the sign-in, registration, and recovery forms. */
export function EmailField({ label = "Email", hint }: { label?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint} required>
      <Input name="email" type="email" autoComplete="email" maxLength={320} required />
    </Field>
  );
}

/** New password + confirmation inputs (12–128 characters). */
export function NewPasswordFields({
  label = "Password",
  confirmLabel = "Confirm password",
}: {
  label?: string;
  confirmLabel?: string;
}) {
  return (
    <>
      <Field label={label} hint="Use 12 to 128 characters." required>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Field label={confirmLabel} required>
        <Input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
    </>
  );
}

/** Full-width primary submit button for an auth card form. */
export function AuthSubmitButton({
  pending,
  icon,
  children,
}: {
  pending: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <FormActions align="stretch">
      <Button type="submit" size="lg" className="w-full" loading={pending} leadingIcon={icon}>
        {children}
      </Button>
    </FormActions>
  );
}
