"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { categoryGradient } from "@/lib/categories";

const THUMBNAIL_IMAGE_SIZES = "(max-width: 640px) 100vw, 400px";

interface CardThumbnailProps {
  src?: string | null;
  alt: string;
  category?: string | null;
}

function thumbnailInitial(category: string | null | undefined, alt: string) {
  return (category?.[0] ?? alt[0] ?? "?").toUpperCase();
}

function thumbnailBackground(gradient: { from: string; to: string }) {
  return `linear-gradient(135deg, ${gradient.from}2e 0%, ${gradient.to}1a 100%)`;
}

function thumbnailInitialColor(gradient: { from: string }) {
  return `${gradient.from}70`;
}

function ThumbnailInitial({
  initial,
  color,
}: {
  initial: string;
  color: string;
}) {
  return (
    <span
      className={cn(
        "absolute inset-0 flex items-center justify-center",
        "font-[family-name:var(--font-display)] text-[length:var(--text-4xl)] font-bold select-none tracking-[-0.02em]",
      )}
      style={{ color }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

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
}: CardThumbnailProps) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const grad = categoryGradient(category);
  const initial = thumbnailInitial(category, alt);
  const showPlaceholder = !src || errored;
  const handleImageLoad = () => setLoaded(true);
  const handleImageError = () => setErrored(true);

  return (
    <div
      className="relative w-full overflow-hidden aspect-[16/9] rounded-[var(--radius-md)] border border-border"
      style={{
        background: thumbnailBackground(grad),
      }}
    >
      {/* Category-initial letter — visible only when no real image */}
      {showPlaceholder && (
        <ThumbnailInitial
          initial={initial}
          color={thumbnailInitialColor(grad)}
        />
      )}

      {/* Real image — overlays the placeholder; fades in after load */}
      {src && !errored && (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes={THUMBNAIL_IMAGE_SIZES}
          className={cn(
            "object-cover transition-opacity [transition-duration:var(--duration-base)]",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      )}
    </div>
  );
}
