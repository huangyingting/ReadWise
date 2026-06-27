"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sun, Moon, Monitor } from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
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
    <IconButton
      onClick={handleClick}
      aria-label={mounted ? NEXT_LABEL[theme] : "Toggle theme"}
      title={mounted ? NEXT_LABEL[theme] : undefined}
      className={cn(
        "h-11 w-11 rounded-[var(--radius-md)] text-text-muted hover:text-text",
        className,
      )}
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch. */}
      {mounted ? <Icon size={20} aria-hidden /> : <Monitor size={20} aria-hidden />}
    </IconButton>
  );
}
