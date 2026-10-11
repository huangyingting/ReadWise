"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui";

type Provider = {
  id: string;
  name: string;
};

type SignInButtonsProps = {
  providers: Provider[];
  callbackUrl: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Continue with Google",
  "azure-ad": "Continue with Microsoft",
};

function getProviderLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider.id] ?? `Continue with ${provider.name}`;
}

export default function SignInButtons({
  providers,
  callbackUrl,
}: SignInButtonsProps) {
  const [pending, setPending] = useState<string | null>(null);

  function handleProviderSignIn(providerId: string) {
    setPending(providerId);
    signIn(providerId, { callbackUrl });
  }

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex items-center gap-[var(--space-3)]" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[length:var(--text-xs)] uppercase tracking-wide text-text-subtle">
          Linked accounts
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <p className="text-center text-[length:var(--text-xs)] text-text-subtle">
        Social sign-in works after you link the provider from Settings.
      </p>
      <div className="flex flex-col gap-[var(--space-3)]">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            variant="secondary"
            size="lg"
            className="w-full"
            loading={pending === provider.id}
            disabled={pending !== null && pending !== provider.id}
            leadingIcon={<LogIn size={18} aria-hidden />}
            onClick={() => handleProviderSignIn(provider.id)}
          >
            {getProviderLabel(provider)}
          </Button>
        ))}
      </div>
    </div>
  );
}
