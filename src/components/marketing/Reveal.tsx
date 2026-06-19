"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * IntersectionObserver-based scroll reveal — no animation library. The element
 * starts in `.rw-reveal` (hidden, offset) and gains `.rw-revealed` the first
 * time it scrolls into view. The CSS `prefers-reduced-motion` override forces
 * it visible immediately, and we also reveal eagerly when IO is unavailable.
 */
export function Reveal({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || revealed) return;

    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <div
      ref={ref}
      data-animate=""
      className={cn("rw-reveal", revealed && "rw-revealed", className)}
      {...props}
    >
      {children}
    </div>
  );
}
