"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import {
  getThemePreference,
  toggleTheme,
  type Theme,
} from "@/lib/theme";

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

// Label describes what the NEXT click will do (standard convention).
const NEXT_LABEL: Record<Theme, string> = {
  light: "Switch to dark mode",
  dark: "Switch to system theme",
  system: "Switch to light mode",
};

export default function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setThemeState] = useState<Theme>("system");
  const pathname = usePathname();

  // On reader pages the reading-mode control (Light/Sepia/Dark) in ReaderControls
  // serves as the single theme source of truth. Hide the global toggle to avoid
  // two overlapping theme knobs on the same page.
  const isReaderPage = pathname.startsWith("/reader/");

  useEffect(() => {
    setThemeState(getThemePreference());
    setMounted(true);
  }, []);

  function handleClick() {
    setThemeState(toggleTheme());
  }

  if (isReaderPage) return null;

  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={mounted ? NEXT_LABEL[theme] : "Toggle theme"}
      title={mounted ? NEXT_LABEL[theme] : undefined}
      className={cn(
        "inline-flex items-center justify-center h-11 w-11 shrink-0",
        "rounded-[var(--radius-md)] text-text-muted",
        "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
        "hover:bg-bg-subtle hover:text-text",
        focusRing,
        className,
      )}
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch. */}
      {mounted ? <Icon size={20} aria-hidden /> : <Monitor size={20} aria-hidden />}
    </button>
  );
}
