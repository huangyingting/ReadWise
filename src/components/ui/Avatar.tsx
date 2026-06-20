"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

function getInitials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export interface AvatarProps {
  /** Remote or local image URL. Falls back to initials when absent or on load error. */
  src?: string | null;
  /** Used to derive initials and as the accessible alt/aria-label. */
  name?: string | null;
  /** Pixel dimensions for both width and height (square). Defaults to 56. */
  size?: number;
  className?: string;
}

/**
 * Round avatar that renders a `next/image` when `src` is provided, and
 * gracefully degrades to an initials circle on load error or missing src.
 *
 * Always passes `unoptimized` to next/image so remote OAuth provider images
 * don't require a `remotePatterns` config.
 */
export default function Avatar({ src, name, size = 56, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(src) && !imgError;
  const initials = getInitials(name);
  const label = name ?? "avatar";

  // Derive a readable font size relative to the avatar size.
  const fontSize =
    size <= 28
      ? "var(--text-sm)"
      : size <= 40
        ? "var(--text-base)"
        : "var(--text-lg)";

  if (showImage) {
    return (
      <Image
        src={src!}
        alt={label}
        width={size}
        height={size}
        unoptimized
        className={cn("rounded-full shrink-0 object-cover", className)}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "rounded-full shrink-0 inline-flex items-center justify-center",
        "bg-bg-subtle border border-border",
        "text-text-muted font-semibold select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize }}
    >
      {initials}
    </div>
  );
}
