import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonVariants } from "./Button";

interface EmptyStateLinkAction {
  label: string;
  href: string;
}

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional decorative icon displayed in the state chip. */
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** CTA rendered as a primary Button-styled Link, or a custom primitive. */
  action?: EmptyStateLinkAction | React.ReactNode;
  /** Element used for the title. Defaults to `p` for listing contexts. */
  titleAs?: "h1" | "h2" | "h3" | "p";
}

const EMPTY_STATE_CLASS = [
  "col-span-full flex flex-col items-center text-center",
  "gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-7)]",
  "rounded-[var(--radius-lg)] border border-dashed border-border bg-bg-subtle",
];
const ICON_CHIP_CLASS =
  "inline-flex h-[var(--space-8)] w-[var(--space-8)] items-center justify-center rounded-[var(--radius-full)] border border-border bg-surface text-text-subtle";
const TITLE_CLASS =
  "m-0 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text";
const DESCRIPTION_CLASS =
  "m-0 max-w-[40ch] text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-text-muted";

function isLinkAction(action: EmptyStateProps["action"]): action is EmptyStateLinkAction {
  return (
    typeof action === "object" &&
    action !== null &&
    !React.isValidElement(action) &&
    "href" in action &&
    "label" in action
  );
}

function renderAction(action: EmptyStateProps["action"]): React.ReactNode {
  if (!action) {
    return null;
  }

  if (isLinkAction(action)) {
    return (
      <Link
        href={action.href}
        className={buttonVariants({ variant: "primary", size: "sm" })}
      >
        {action.label}
      </Link>
    );
  }

  return <div>{action}</div>;
}

/**
 * Standard empty-state panel.
 *
 * Keyboard/focus: the container is not focusable. Link actions use Button
 * styling and keep native link keyboard behavior; custom actions should use UI
 * primitives with their built-in focus rings.
 * Accessibility: the icon is decorative (`aria-hidden`); choose `titleAs="h1"`
 * only when the empty state is the page's primary heading.
 *
 * @example
 * <EmptyState icon={Inbox} title="No articles yet" action={{ label: "Browse", href: "/browse" }} />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  titleAs: TitleTag = "p",
  className,
  ...props
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(...EMPTY_STATE_CLASS, className)}
      {...props}
    >
      {Icon ? (
        <div className={ICON_CHIP_CLASS} aria-hidden>
          <Icon size={20} />
        </div>
      ) : null}

      <TitleTag className={TITLE_CLASS}>{title}</TitleTag>

      {description ? (
        <p className={DESCRIPTION_CLASS}>{description}</p>
      ) : null}

      {renderAction(action)}
    </div>
  );
}