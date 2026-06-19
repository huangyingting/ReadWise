"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { LogIn, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

type Provider = {
  id: string;
  name: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Continue with Google",
  "azure-ad": "Continue with Microsoft",
};

export default function SignInButtons({
  providers,
  callbackUrl,
}: {
  providers: Provider[];
  callbackUrl: string;
}) {
  const [pending, setPending] = useState<string | null>(null);

  if (providers.length === 0) {
    return (
      <div className="flex items-start gap-[var(--space-2)] text-text-muted text-[length:var(--text-sm)]">
        <AlertTriangle size={16} aria-hidden className="shrink-0 mt-px" />
        <span>
          No authentication providers are configured. Set OAuth credentials in
          the environment to enable sign-in.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {providers.map((p) => (
        <Button
          key={p.id}
          variant="secondary"
          size="lg"
          className="w-full"
          loading={pending === p.id}
          disabled={pending !== null && pending !== p.id}
          leadingIcon={<LogIn size={18} aria-hidden />}
          onClick={() => {
            setPending(p.id);
            signIn(p.id, { callbackUrl });
          }}
        >
          {PROVIDER_LABELS[p.id] ?? `Continue with ${p.name}`}
        </Button>
      ))}
    </div>
  );
}
