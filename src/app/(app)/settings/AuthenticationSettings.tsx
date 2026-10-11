"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { KeyRound, Link2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardMeta,
  CardTitle,
  Field,
  FormActions,
  Input,
  Stack,
} from "@/components/ui";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

type Provider = {
  id: string;
  name: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  "azure-ad": "Microsoft",
};

export default function AuthenticationSettings({
  initialHasPassword,
  linkedProviders,
  configuredProviders,
}: {
  initialHasPassword: boolean;
  linkedProviders: string[];
  configuredProviders: Provider[];
}) {
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [pending, setPending] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setMessage("");
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const result = await accountAdmissionRequest<{ created: boolean }>(
        "/api/account/auth-methods",
        {
          currentPassword: hasPassword
            ? String(form.get("currentPassword") ?? "")
            : undefined,
          password,
        },
        "PUT",
      );
      setHasPassword(true);
      setMessage(
        result.created
          ? "Password sign-in is now enabled."
          : "Your password was changed.",
      );
      formElement.reset();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The password could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  function linkProvider(providerId: string) {
    setLinking(providerId);
    signIn(providerId, { callbackUrl: "/settings" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">Sign-in methods</CardTitle>
        <CardMeta>
          Manage your password and link verified social accounts with the same
          email address.
        </CardMeta>
      </CardHeader>
      <CardBody>
        <Stack gap="5">
          <Stack gap="3">
            <div className="flex items-center justify-between gap-[var(--space-3)]">
              <div>
                <div className="font-semibold text-text">Password</div>
                <div className="text-[length:var(--text-sm)] text-text-muted">
                  {hasPassword
                    ? "Available for email sign-in."
                    : "Add a password as a recovery sign-in method."}
                </div>
              </div>
              <Badge variant={hasPassword ? "success" : "neutral"}>
                {hasPassword ? "Enabled" : "Not set"}
              </Badge>
            </div>

            <form onSubmit={handlePassword}>
              <Stack gap="3">
                {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
                {message ? (
                  <AuthNotice tone="success">{message}</AuthNotice>
                ) : null}
                {hasPassword ? (
                  <Field label="Current password" required>
                    <Input
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      maxLength={128}
                      required
                    />
                  </Field>
                ) : null}
                <Field
                  label={hasPassword ? "New password" : "Password"}
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
                <FormActions align="start">
                  <Button
                    type="submit"
                    loading={pending}
                    leadingIcon={<KeyRound size={16} aria-hidden />}
                  >
                    {hasPassword ? "Change password" : "Add password"}
                  </Button>
                </FormActions>
              </Stack>
            </form>
          </Stack>

          <div className="border-t border-border pt-[var(--space-5)]">
            <Stack gap="3">
              <div>
                <div className="font-semibold text-text">Social accounts</div>
                <div className="text-[length:var(--text-sm)] text-text-muted">
                  Link a provider only when its verified email matches this
                  ReadWise account.
                </div>
              </div>
              {configuredProviders.length === 0 ? (
                <AuthNotice tone="neutral">
                  No social providers are configured by the operator.
                </AuthNotice>
              ) : (
                configuredProviders.map((provider) => {
                  const linked = linkedProviders.includes(provider.id);
                  return (
                    <div
                      key={provider.id}
                      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border p-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-medium text-text">
                          {PROVIDER_LABELS[provider.id] ?? provider.name}
                        </div>
                        <div className="text-[length:var(--text-xs)] text-text-subtle">
                          {linked
                            ? "Connected for sign-in."
                            : "Not connected."}
                        </div>
                      </div>
                      {linked ? (
                        <Badge variant="success">Connected</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={linking === provider.id}
                          disabled={linking !== null}
                          leadingIcon={<Link2 size={15} aria-hidden />}
                          onClick={() => linkProvider(provider.id)}
                        >
                          Link account
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </Stack>
          </div>
        </Stack>
      </CardBody>
    </Card>
  );
}
