"use client";

import { RotateCcw, Frown, Check, ChevronsRight } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import type { Grade } from "./types";

interface GradeButtonsProps {
  onGrade: (g: Grade) => void;
  disabled: boolean;
  goodRef: React.RefObject<HTMLButtonElement | null>;
}

const GRADES: {
  grade: Grade;
  label: string;
  key: string;
  tooltip: string;
  icon: React.ReactNode;
  variant: "outline" | "primary";
  tintClass: string;
  hoverStyle?: React.CSSProperties;
}[] = [
  {
    grade: "again",
    label: "Again",
    key: "1",
    tooltip: "Didn't remember — repeat today",
    icon: <RotateCcw size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--danger-text)]",
    hoverStyle: {
      "--hover-bg": "color-mix(in srgb, var(--danger) 10%, transparent)",
    } as React.CSSProperties,
  },
  {
    grade: "hard",
    label: "Hard",
    key: "2",
    tooltip: "Remembered with difficulty — review sooner",
    icon: <Frown size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--warning-text)]",
    hoverStyle: {
      "--hover-bg": "color-mix(in srgb, var(--warning) 10%, transparent)",
    } as React.CSSProperties,
  },
  {
    grade: "good",
    label: "Good",
    key: "3",
    tooltip: "Remembered well — normal interval",
    icon: <Check size={14} aria-hidden />,
    variant: "primary",
    tintClass: "",
  },
  {
    grade: "easy",
    label: "Easy",
    key: "4",
    tooltip: "Too easy — longer interval next time",
    icon: <ChevronsRight size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--success-text)]",
    hoverStyle: {
      "--hover-bg": "color-mix(in srgb, var(--success) 10%, transparent)",
    } as React.CSSProperties,
  },
];

export function GradeButtons({ onGrade, disabled, goodRef }: GradeButtonsProps) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-2)] w-full"
      style={{ marginTop: "var(--space-4)" }}
    >
      {GRADES.map(
        ({ grade, label, key, tooltip, icon, variant, tintClass, hoverStyle }) => (
          <button
            key={grade}
            ref={grade === "good" ? goodRef : undefined}
            type="button"
            disabled={disabled}
            onClick={() => onGrade(grade)}
            title={tooltip}
            style={hoverStyle}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5",
              "h-11 min-h-[44px] px-[var(--space-2)] w-full",
              "rounded-[var(--radius-md)] font-semibold select-none",
              "transition-[background-color,border-color,box-shadow,transform]",
              "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
              "active:translate-y-px",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
              focusRing,
              variant === "primary"
                ? "bg-primary text-on-primary shadow-[var(--shadow-sm)] hover:bg-primary-hover active:shadow-none"
                : "bg-transparent text-text border border-border-strong hover:bg-[color:var(--hover-bg)]",
            )}
          >
            <span
              className={cn(
                "inline-flex items-center gap-[var(--space-1)]",
                tintClass,
              )}
            >
              {icon}
              <span className="text-[length:var(--text-sm)]">{label}</span>
            </span>
            <span className="hidden sm:block text-[length:var(--text-xs)] text-text-subtle">
              {key}
            </span>
          </button>
        ),
      )}
    </div>
  );
}
