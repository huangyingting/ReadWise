import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { getConfiguredProviders } from "@/lib/auth-providers";
import { friendlySignInError, sanitizeCallbackUrl } from "@/lib/signin-helpers";
import { Wordmark } from "@/components/marketing/Wordmark";
import { Wordmark as AppWordmark } from "@/components/Wordmark";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { Card, PageShell, Stack } from "@/components/ui";
import { cn, focusRing } from "@/lib/cn";
import SignInButtons from "./SignInButtons";
import { signIn as signInPage } from "@/lib/copy/pages";

export const metadata = signInPage;

const textLinkClasses = cn(
  "rounded-[var(--radius-xs)] underline underline-offset-2 transition-colors",
  "[transition-duration:var(--duration-fast)] hover:text-text",
  focusRing,
);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const safeCallback = sanitizeCallbackUrl(callbackUrl);

  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(safeCallback);
  }

  const providers = getConfiguredProviders();

  const errorMessage = friendlySignInError(error);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-bg">
      {/* Minimal top bar */}
      <PageShell
        variant="listing"
        density="compact"
        className="flex min-h-[var(--marketing-header-h)] items-center justify-between px-[var(--space-6)] py-0"
      >
        <Wordmark />
        <ThemeToggle />
      </PageShell>

      {/* Centered auth region */}
      <div className="flex-1 grid place-items-center px-[var(--space-4)] py-[var(--space-10)]">
        <Card className="w-full max-w-[400px] rw-fade-up">
          <Stack gap="5">
            {/* Brand mark + heading */}
            <Stack gap="2" align="center" className="text-center">
              <AppWordmark size="large" />
              <h1 className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-2xl)] leading-[var(--leading-snug)] text-text">
                Sign in to ReadWise
              </h1>
              <p className="text-text-muted text-[length:var(--text-base)]">
                Read real news at your level — with instant translation,
                vocabulary, and narration.
              </p>
            </Stack>

            {/* Error banner */}
            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-[var(--space-2)] text-danger-text text-[length:var(--text-sm)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] rounded-[var(--radius-md)] p-[var(--space-3)]"
              >
                <AlertTriangle
                  size={16}
                  aria-hidden
                  className="shrink-0 translate-y-[calc(var(--space-1)/4)]"
                />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Provider buttons */}
            <SignInButtons providers={providers} callbackUrl={safeCallback} />

            {/* Terms / Privacy disclosure */}
            <p className="text-center text-text-subtle text-[length:var(--text-xs)] leading-[var(--leading-normal)]">
              By continuing, you agree to our{" "}
              <Link href="/terms" className={textLinkClasses}>
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className={textLinkClasses}>
                Privacy Policy
              </Link>
              .
            </p>

            {/* Back to home */}
            <div className="text-center">
              <Link
                href="/"
                className={cn(
                  "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-xs)] text-text-subtle text-[length:var(--text-sm)] no-underline transition-colors",
                  "[transition-duration:var(--duration-fast)] hover:text-text hover:underline",
                  focusRing,
                )}
              >
                <ArrowLeft size={14} aria-hidden />
                Back to home
              </Link>
            </div>
          </Stack>
        </Card>
      </div>
    </main>
  );
}
