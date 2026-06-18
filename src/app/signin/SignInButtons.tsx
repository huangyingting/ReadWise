"use client";

import { signIn } from "next-auth/react";

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
  if (providers.length === 0) {
    return (
      <p className="muted">
        No authentication providers are configured. Set OAuth credentials in the
        environment to enable sign-in.
      </p>
    );
  }

  return (
    <div className="stack">
      {providers.map((p) => (
        <button
          key={p.id}
          className="btn"
          onClick={() => signIn(p.id, { callbackUrl })}
        >
          {PROVIDER_LABELS[p.id] ?? `Continue with ${p.name}`}
        </button>
      ))}
    </div>
  );
}
