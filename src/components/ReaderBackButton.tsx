"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { READER_REFERRER_KEY } from "@/lib/reader-referrer";

interface StoredReaderReferrer {
  href: string;
  label?: string;
}

function isStoredReaderReferrer(value: unknown): value is StoredReaderReferrer {
  return (
    !!value &&
    typeof value === "object" &&
    "href" in value &&
    typeof value.href === "string"
  );
}

/**
 * Back button in the reader that returns the user to the listing they came from.
 * Reads a referrer URL set in sessionStorage by ArticleCardView (or any listing
 * that sets the key before navigating to the reader). Falls back to /dashboard.
 */
export default function ReaderBackButton() {
  const [href, setHref] = useState("/dashboard");
  const [label, setLabel] = useState("Dashboard");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(READER_REFERRER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isStoredReaderReferrer(parsed)) {
          const { href: storedHref, label: storedLabel } = parsed;
          setHref(storedHref);
          setLabel(storedLabel ?? "Back");
        }
      }
    } catch {
      // Ignore storage errors — fall back to /dashboard.
    }
  }, []);

  return (
    <Link
      href={href}
      aria-label={`Back to ${label}`}
      className={cn(
        "reader-back-btn",
        focusRing,
      )}
    >
      <ArrowLeft size={16} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
