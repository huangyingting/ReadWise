"use client";

import { RotateCcw, Frown, Check, ChevronsRight } from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Button, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Grade } from "./types";

interface GradeButtonsProps {
  onGrade: (g: Grade) => void;
  disabled: boolean;
  goodRef: RefObject<HTMLButtonElement | null>;
}

type GradeButtonConfig = {
  grade: Grade;
  label: string;
  shortcutKey: string;
  tooltip: string;
  icon: ReactNode;
  variant: "outline" | "primary";
  tintClass: string;
  hoverStyle?: CSSProperties;
};

function gradeHoverStyle(token: "danger" | "warning" | "success"): CSSProperties {
  return {
    "--hover-bg": `color-mix(in srgb, var(--${token}) 10%, transparent)`,
  } as CSSProperties;
}

function getGradeButtonClassName(variant: GradeButtonConfig["variant"]) {
  return cn(
    "flex flex-col items-center justify-center gap-0.5",
    "h-11 min-h-[44px] px-[var(--space-2)] w-full",
    variant !== "primary" && "hover:bg-[color:var(--hover-bg)]",
  );
}

const GRADES: GradeButtonConfig[] = [
  {
    grade: "again",
    label: "Again",
    shortcutKey: "1",
    tooltip: "Didn't remember — repeat today",
    icon: <RotateCcw size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--danger-text)]",
    hoverStyle: gradeHoverStyle("danger"),
  },
  {
    grade: "hard",
    label: "Hard",
    shortcutKey: "2",
    tooltip: "Remembered with difficulty — review sooner",
    icon: <Frown size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--warning-text)]",
    hoverStyle: gradeHoverStyle("warning"),
  },
  {
    grade: "good",
    label: "Good",
    shortcutKey: "3",
    tooltip: "Remembered well — normal interval",
    icon: <Check size={14} aria-hidden />,
    variant: "primary",
    tintClass: "",
  },
  {
    grade: "easy",
    label: "Easy",
    shortcutKey: "4",
    tooltip: "Too easy — longer interval next time",
    icon: <ChevronsRight size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--success-text)]",
    hoverStyle: gradeHoverStyle("success"),
  },
];

export function GradeButtons({ onGrade, disabled, goodRef }: GradeButtonsProps) {
  return (
    <div
      className="mt-[var(--space-4)] grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-2)] w-full"
    >
      {GRADES.map(
        ({
          grade,
          label,
          shortcutKey,
          tooltip,
          icon,
          variant,
          tintClass,
          hoverStyle,
        }) => (
          <Tooltip key={grade} content={tooltip} className="w-full">
            <Button
              ref={grade === "good" ? goodRef : undefined}
              variant={variant}
              size="md"
              disabled={disabled}
              onClick={() => onGrade(grade)}
              style={hoverStyle}
              className={getGradeButtonClassName(variant)}
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
              {shortcutKey}
            </span>
            </Button>
          </Tooltip>
        ),
      )}
    </div>
  );
}
