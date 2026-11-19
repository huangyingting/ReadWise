"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { buttonVariants } from "@/components/ui/Button";
import { clientErrorMessage, postJson } from "@/lib/client-fetch";
import { Notice } from "@/components/ui/Notice";

export default function VerifyEmailState({ token }: { token: string }) {
  const [state, setState] = useState<"pending" | "complete" | "error">(
    "pending",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    postJson("/api/auth/verify-email", { token })
      .then(() => {
        if (active) setState("complete");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(clientErrorMessage(requestError, "Email verification failed."));
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
    return <Notice tone="danger">{error}</Notice>;
  }
  return (
    <>
      <Notice tone="success">
        Your email is verified and your account is ready.
      </Notice>
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
