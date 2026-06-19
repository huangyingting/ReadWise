import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { Wordmark } from "@/components/marketing/Wordmark";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { Card } from "@/components/ui";
import SignInButtons from "./SignInButtons";

export const metadata = {
  title: "Sign in — ReadWise",
};

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already linked to a different sign-in method.",
  AccessDenied: "Sign-in was cancelled or denied.",
};

function friendlyError(code: string | undefined): string | null {
  if (!code) return null;
  return (
    ERROR_MESSAGES[code] ??
    "Something went wrong signing you in. Please try again."
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/dashboard";

  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(safeCallback);
  }

  const providers = (authOptions.providers ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const errorMessage = friendlyError(error);

  return (
    <main className="min-h-[100dvh] flex flex-col bg-bg">
      {/* Minimal top bar */}
      <div className="h-16 flex items-center justify-between max-w-[1200px] w-full mx-auto px-[var(--space-6)]">
        <Wordmark />
        <ThemeToggle />
      </div>

      {/* Centered auth region */}
      <div className="flex-1 grid place-items-center px-[var(--space-4)] py-[var(--space-10)]">
        <Card className="max-w-[400px] w-full flex flex-col gap-[var(--space-5)] rw-fade-up">
          {/* Brand mark + heading */}
          <div className="flex flex-col items-center gap-[var(--space-2)] text-center">
            <svg
              width="40"
              height="40"
              viewBox="0 0 16 16"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.6"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 1.5 14.5 8 8 14.5 1.5 8 8 1.5Z" />
              <path d="M8 4.5v7" />
            </svg>
            <h1 className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-2xl)] leading-[var(--leading-snug)] text-text">
              Sign in to ReadWise
            </h1>
            <p className="text-text-muted text-[length:var(--text-base)]">
              Read real news at your level — with instant translation,
              vocabulary, and narration.
            </p>
          </div>

          {/* Error banner */}
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-[var(--space-2)] text-danger-text text-[length:var(--text-sm)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] rounded-[var(--radius-md)] p-[var(--space-3)]"
            >
              <AlertTriangle
                size={16}
                aria-hidden
                className="shrink-0 mt-px"
              />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Provider buttons */}
          <SignInButtons providers={providers} callbackUrl={safeCallback} />

          {/* Back to home */}
          <div className="text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-[var(--space-1)] text-text-subtle text-[length:var(--text-sm)] no-underline hover:text-text hover:underline transition-colors [transition-duration:var(--duration-fast)]"
            >
              <ArrowLeft size={14} aria-hidden />
              Back to home
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
