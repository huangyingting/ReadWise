import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Wordmark, WordmarkLink } from "@/components/Wordmark";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { Card, PageShell, Stack } from "@/components/ui";
import { cn, focusRing } from "@/lib/cn";

export const authTextLinkClasses = cn(
  "rounded-[var(--radius-xs)] font-medium text-primary underline underline-offset-2 transition-colors",
  "[transition-duration:var(--duration-fast)] hover:text-primary-hover",
  focusRing,
);

export function AuthShell({
  title,
  description,
  children,
  backHref = "/signin",
  backLabel = "Back to sign in",
}: {
  title: string;
  description: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-bg">
      <PageShell
        variant="listing"
        density="compact"
        className="flex min-h-[var(--marketing-header-h)] items-center justify-between px-[var(--space-6)] py-0"
      >
        <WordmarkLink href="/" ariaLabel="ReadWise home" size="marketing" />
        <ThemeToggle />
      </PageShell>

      <div className="grid flex-1 place-items-center px-[var(--space-4)] py-[var(--space-10)]">
        <Card className="w-full max-w-[440px] rw-fade-up">
          <Stack gap="5">
            <Stack gap="2" align="center" className="text-center">
              <Wordmark size="large" />
              <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold leading-[var(--leading-snug)] text-text">
                {title}
              </h1>
              <p className="text-[length:var(--text-base)] text-text-muted">
                {description}
              </p>
            </Stack>

            {children}

            <div className="text-center">
              <Link
                href={backHref}
                className={cn(
                  "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-xs)] text-[length:var(--text-sm)] text-text-subtle no-underline transition-colors",
                  "[transition-duration:var(--duration-fast)] hover:text-text hover:underline",
                  focusRing,
                )}
              >
                <ArrowLeft size={14} aria-hidden />
                {backLabel}
              </Link>
            </div>
          </Stack>
        </Card>
      </div>
    </main>
  );
}

export function AuthNotice({
  tone,
  children,
}: {
  tone: "error" | "success" | "neutral";
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border p-[var(--space-3)] text-[length:var(--text-sm)]",
        tone === "error" &&
          "border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger-text",
        tone === "success" &&
          "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success-text",
        tone === "neutral" &&
          "border-border bg-bg-subtle text-text-muted",
      )}
    >
      <Icon
        size={16}
        aria-hidden
        className="shrink-0 translate-y-[calc(var(--space-1)/4)]"
      />
      <span>{children}</span>
    </div>
  );
}
