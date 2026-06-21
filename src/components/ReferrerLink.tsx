"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

const READER_REFERRER_KEY = "readwise:reader-referrer";

interface ReferrerLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  /** Human-readable label for the back button (e.g. "Browse" or "Dashboard"). */
  referrerLabel?: string;
  /** The URL to store as the referrer (defaults to current page href). */
  referrerHref?: string;
}

/**
 * A Next.js Link that records the current listing URL in sessionStorage before
 * navigating, so the reader's back button can return to it.
 *
 * Wrap this around article card links instead of using Link directly.
 */
export default function ReferrerLink({
  referrerLabel,
  referrerHref,
  onClick,
  children,
  ...props
}: ReferrerLinkProps) {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    try {
      const href = referrerHref ?? window.location.pathname + window.location.search;
      const label = referrerLabel ?? document.title ?? "Back";
      sessionStorage.setItem(
        READER_REFERRER_KEY,
        JSON.stringify({ href, label }),
      );
    } catch {
      // Ignore storage errors.
    }
    onClick?.(e);
  }

  return (
    <Link {...props} onClick={handleClick}>
      {children}
    </Link>
  );
}
