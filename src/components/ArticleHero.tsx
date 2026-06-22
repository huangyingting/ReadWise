"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/Skeleton";

export interface ArticleHeroProps {
  /** Remote (or local) hero image URL. Renders nothing when absent. */
  src?: string | null;
  /** Accessible alt text — typically the article title. */
  alt: string;
  /**
   * `reader` (default) is the full-width hero shown above the article body.
   * `thumb` is the compact 16:9 thumbnail used at the top of a listing card.
   */
  variant?: "reader" | "thumb";
  className?: string;
}

/**
 * Renders an article image inside an intrinsic 16:9 container using `next/image`
 * with `unoptimized` (mirroring the avatar approach) so any remote host works
 * without a `remotePatterns` whitelist.
 *
 * Loading state: a Skeleton shimmer fills the 16:9 frame until `onLoad` fires,
 * preventing a flat dark void in dark mode.
 *
 * Graceful failure: on load error (or missing `src`) the whole container
 * collapses to nothing — no empty bordered box, no broken-image icon, and no
 * cumulative layout shift beyond the image area itself.
 */
export default function ArticleHero({
  src,
  alt,
  variant = "reader",
  className,
}: ArticleHeroProps) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!src || errored) return null;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden aspect-[16/9]",
        variant === "reader"
          ? "mx-auto max-w-[min(100%,760px)] max-h-[420px] rounded-[var(--radius-lg)] border border-border shadow-[var(--shadow-sm)] my-[var(--space-4)]"
          : "rounded-[var(--radius-md)] border border-border",
        className,
      )}
    >
      {/* Shimmer shown until the image loads */}
      {!loaded && (
        <Skeleton
          shape="block"
          className="absolute inset-0 rounded-none"
          aria-hidden
        />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        sizes={
          variant === "reader"
            ? "(max-width: 760px) 100vw, 760px"
            : "(max-width: 640px) 100vw, 400px"
        }
        className="object-cover"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </div>
  );
}
