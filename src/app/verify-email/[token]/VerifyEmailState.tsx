"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { buttonVariants } from "@/components/ui/Button";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

export default function VerifyEmailState({ token }: { token: string }) {
  const [state, setState] = useState<"pending" | "complete" | "error">(
    "pending",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    accountAdmissionRequest("/api/auth/verify-email", { token })
      .then(() => {
        if (active) setState("complete");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Email verification failed.",
        );
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state === "pending") {
    return (
      <div className="flex items-center justify-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-text-muted">
        <Spinner size={18} />
        Verifying your email…
      </div>
    );
  }
  if (state === "error") {
    return <AuthNotice tone="error">{error}</AuthNotice>;
  }
  return (
    <>
      <AuthNotice tone="success">
        Your email is verified and your account is ready.
      </AuthNotice>
      <Link
        href="/onboarding"
        className={buttonVariants({
          variant: "primary",
          size: "lg",
          className: "w-full",
        })}
      >
        Continue
      </Link>
    </>
  );
}
