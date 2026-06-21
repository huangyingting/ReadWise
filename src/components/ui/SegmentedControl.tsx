"use client";

import * as React from "react";
import { cn, focusRing } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

/** A single selectable segment within a {@link SegmentedControl}. */
export interface SegmentedControlOption<T extends string> {
  /** Stable value emitted via `onChange` when this segment is selected. */
  value: T;
  /** Human-readable label (also used for the segment's accessible name). */
  label: string;
  /**
   * Optional leading icon. Receives a `size` prop so it scales with the
   * control's `size` variant (lucide-react icons are compatible).
   */
  icon?: React.ComponentType<{ size?: number }>;
  /** Optional tooltip text shown on hover/focus of the segment. */
  tooltip?: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Currently selected value (controlled). */
  value: T;
  /** Called with the new value when the selection changes. */
  onChange: (value: T) => void;
  /** The selectable segments, rendered left-to-right. */
  options: ReadonlyArray<SegmentedControlOption<T>>;
  /** Accessible label for the radiogroup (e.g. "Reading theme"). */
  label: string;
  /** Visual density. Defaults to `"md"`. */
  size?: "sm" | "md";
  /** Optional extra classes for the track element. */
  className?: string;
}

/** Per-size geometry tokens, kept in one place for readability. */
const SIZE_STYLES = {
  sm: {
    iconPx: 14,
    segment:
      "h-7 gap-[var(--space-1)] px-[var(--space-2)] text-[length:var(--text-xs)]",
  },
  md: {
    iconPx: 16,
    segment:
      "h-9 gap-[var(--space-2)] px-[var(--space-3)] text-[length:var(--text-sm)]",
  },
} as const;

/**
 * SegmentedControl — a generic, token-styled pill/segmented control.
 *
 * Implements the WAI-ARIA radiogroup pattern with **roving tabindex**:
 *  - Only the checked segment is in the tab order (`tabIndex={0}`); the rest
 *    are `tabIndex={-1}` so a single Tab lands on the active option.
 *  - ArrowLeft/ArrowUp and ArrowRight/ArrowDown move selection **and** focus,
 *    wrapping around the ends. Home/End jump to the first/last option.
 *  - Changes are announced through a visually-hidden
 *    `role="status" aria-live="polite"` region inside the component.
 *
 * Visuals are driven entirely by design tokens (`--radius-*`, `bg-bg-subtle`
 * track, active segment `bg-surface` + teal `accent`), so it is dark-mode
 * correct without extra work.
 *
 * Generic over `T extends string` — the option `value`s and the `onChange`
 * payload share the same literal union, e.g.
 * `SegmentedControl<"light" | "sepia" | "dark">`.
 *
 * @example
 * ```tsx
 * <SegmentedControl
 *   label="Reading theme"
 *   value={mode}
 *   onChange={setMode}
 *   options={[
 *     { value: "light", label: "Light", icon: Sun },
 *     { value: "sepia", label: "Sepia", icon: Contrast },
 *     { value: "dark", label: "Dark", icon: Moon },
 *   ]}
 * />
 * ```
 *
 * This is the reusable replacement for the three hand-rolled radiogroups in
 * `ReaderControls.tsx`; it is intentionally additive and rewires no consumers.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: SegmentedControlProps<T>): React.ReactElement {
  const [announcement, setAnnouncement] = React.useState("");
  const groupRef = React.useRef<HTMLDivElement>(null);
  const sizeStyles = SIZE_STYLES[size];

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  /** Focus the segment at `index` and emit its value. */
  function selectIndex(index: number) {
    const option = options[index];
    if (!option) return;
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
      "[role='radio']",
    );
    buttons?.[index]?.focus();
    if (option.value !== value) {
      onChange(option.value);
    }
    // Reset then set so identical consecutive announcements still re-fire.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(`${label}: ${option.label}`));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const count = options.length;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectIndex((selectedIndex + 1) % count);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectIndex((selectedIndex - 1 + count) % count);
        break;
      case "Home":
        event.preventDefault();
        selectIndex(0);
        break;
      case "End":
        event.preventDefault();
        selectIndex(count - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className={cn("inline-flex flex-col", className)}>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className={cn(
          "inline-flex items-center gap-[2px] rounded-[var(--radius-full)]",
          "border border-border bg-bg-subtle p-[2px]",
        )}
      >
        {options.map((option, index) => {
          const isActive = option.value === value;
          const Icon = option.icon;
          const button = (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={option.label}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectIndex(index)}
              className={cn(
                "inline-flex items-center justify-center rounded-[var(--radius-full)]",
                "font-medium whitespace-nowrap select-none cursor-pointer",
                "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
                sizeStyles.segment,
                isActive
                  ? "bg-surface text-accent-text shadow-[var(--shadow-sm)]"
                  : "text-text-muted hover:text-text",
                focusRing,
              )}
            >
              {Icon ? <Icon size={sizeStyles.iconPx} /> : null}
              <span>{option.label}</span>
            </button>
          );

          return option.tooltip ? (
            <Tooltip key={option.value} content={option.tooltip} side="bottom">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>

      {/* Visually-hidden live region announcing the active selection. */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
