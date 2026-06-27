"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { categoryGradient } from "@/lib/categories";

/**
 * Unified 16:9 card thumbnail.
 *
 * - Always renders a deterministic category-tinted gradient placeholder so the
 *   card grid is uniform regardless of whether an article has a hero image.
 * - When `src` is provided, overlays the real image on top (fade in on load).
 * - If the image fails to load (`onError`) the gradient placeholder remains
 *   visible — no broken-image icon, no cumulative layout shift.
 */
export default function CardThumbnail({
  src,
  alt,
  category,
}: {
  src?: string | null;
  alt: string;
  category?: string | null;
}) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const grad = categoryGradient(category);
  const initial = (category?.[0] ?? alt[0] ?? "?").toUpperCase();
  const showPlaceholder = !src || errored;

  return (
    <div
      className="relative w-full overflow-hidden aspect-[16/9] rounded-[var(--radius-md)] border border-border"
      style={{
        background: `linear-gradient(135deg, ${grad.from}2e 0%, ${grad.to}1a 100%)`,
      }}
    >
      {/* Category-initial letter — visible only when no real image */}
      {showPlaceholder && (
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "font-[family-name:var(--font-display)] text-[length:var(--text-4xl)] font-bold select-none tracking-[-0.02em]",
          )}
          style={{ color: `${grad.from}70` }}
          aria-hidden
        >
          {initial}
        </span>
      )}

      {/* Real image — overlays the placeholder; fades in after load */}
      {src && !errored && (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 640px) 100vw, 400px"
          className={cn(
            "object-cover transition-opacity [transition-duration:var(--duration-base)]",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </div>
  );
}
