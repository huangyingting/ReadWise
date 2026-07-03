"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { LogIn, AlertTriangle } from "lucide-react";
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

function NoProvidersNotice() {
  return (
    <div className="flex items-start gap-[var(--space-2)] text-text-muted text-[length:var(--text-sm)]">
      <AlertTriangle
        size={16}
        aria-hidden
        className="shrink-0 translate-y-[calc(var(--space-1)/4)]"
      />
      <span>
        No authentication providers are configured. Set OAuth credentials in
        the environment to enable sign-in.
      </span>
    </div>
  );
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
    return <NoProvidersNotice />;
  }

  return (
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
  );
}
