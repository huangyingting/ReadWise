import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth/config";
import { getConfiguredProviders } from "@/lib/auth/providers";
import { friendlySignInError, sanitizeCallbackUrl } from "@/lib/signin-helpers";
import { defaultLandingPath } from "@/lib/learner-landing";
import { AuthShell } from "@/components/auth/AuthShell";
import { Notice } from "@/components/ui/Notice";
import { cn, focusRing } from "@/lib/cn";
import SignInButtons from "./SignInButtons";
import PasswordSignInForm from "./PasswordSignInForm";
import { signIn as signInPage } from "@/lib/copy/pages";
import { accountAdmissionMode } from "@/lib/account-admission";

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
  // An explicit, relative callbackUrl is honored (open-redirect-safe); otherwise
  // the learner's flag-aware default landing is used (`/today` when enabled).
  const explicitCallback = callbackUrl ? sanitizeCallbackUrl(callbackUrl) : null;

  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(explicitCallback ?? defaultLandingPath(session.user.role));
  }

  const safeCallback = explicitCallback ?? defaultLandingPath();

  const providers = getConfiguredProviders();

  const errorMessage = friendlySignInError(error);

  return (
    <AuthShell
      title="Sign in to ReadWise"
      description="Read real news at your level — with instant translation, vocabulary, and narration."
      backHref="/"
      backLabel="Back to home"
    >
      {errorMessage ? <Notice tone="danger">{errorMessage}</Notice> : null}

      <PasswordSignInForm callbackUrl={safeCallback} />

      <p className="text-right text-[length:var(--text-sm)] text-text-muted">
        <Link href="/forgot-password" className={textLinkClasses}>
          Forgot password?
        </Link>
      </p>

      <SignInButtons providers={providers} callbackUrl={safeCallback} />

      {accountAdmissionMode() === "public" ? (
        <p className="text-center text-[length:var(--text-sm)] text-text-muted">
          New to ReadWise?{" "}
          <Link href="/register" className={textLinkClasses}>
            Create an account
          </Link>
        </p>
      ) : null}

      <LegalDisclosure />
    </AuthShell>
  );
}

function LegalDisclosure() {
  return (
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
  );
}
