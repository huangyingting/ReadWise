import * as React from "react";
import { Check } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  getHighlightColorCssVar,
  getHighlightColorLabel,
  isHighlightColor,
  type HighlightColor,
  type HighlightColorTone,
} from "./highlight-colors";

type HighlightSwatchStyle = React.CSSProperties & {
  "--hl-swatch-bg"?: string;
};

type SwatchSize = "xs" | "sm" | "md" | "bar";

function getSwatchBackground(
  color: HighlightColor | string | null | undefined,
  tone: HighlightColorTone,
): string {
  return isHighlightColor(color) ? getHighlightColorCssVar(color, tone) : "var(--border)";
}

function setForwardedRef<T>(
  ref: React.Ref<T> | undefined,
  value: T | null,
) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as React.MutableRefObject<T | null>).current = value;
}

export interface HighlightColorSwatchProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  color: HighlightColor | string | null | undefined;
  tone?: HighlightColorTone;
  size?: SwatchSize;
  selected?: boolean;
  decorative?: boolean;
  label?: string;
}

export function HighlightColorSwatch({
  color,
  tone = "fill",
  size = "md",
  selected = false,
  decorative = false,
  label,
  className,
  style,
  ...props
}: HighlightColorSwatchProps): React.ReactElement {
  const styleWithColor: HighlightSwatchStyle = {
    "--hl-swatch-bg": getSwatchBackground(color, tone),
    ...style,
  };
  const accessibleLabel =
    label ??
    (isHighlightColor(color)
      ? `${getHighlightColorLabel(color)} highlight`
      : "No highlight color");

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibleLabel}
      data-size={size}
      data-selected={selected || undefined}
      className={cn("rw-highlight-color-swatch", className)}
      style={styleWithColor}
      {...props}
    />
  );
}

export interface HighlightColorSwatchGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: HighlightColor;
  onChange: (color: HighlightColor) => void;
  label?: string;
  size?: Exclude<SwatchSize, "bar">;
  tone?: HighlightColorTone;
  onEscape?: () => void;
  activeSwatchRef?: React.Ref<HTMLButtonElement>;
  touchTarget?: boolean;
  buttonClassName?: string;
}

export function HighlightColorSwatchGroup({
  value,
  onChange,
  label = "Highlight color",
  size = "md",
  tone = "fill",
  onEscape,
  activeSwatchRef,
  touchTarget = true,
  className,
  buttonClassName,
  onKeyDown,
  ...props
}: HighlightColorSwatchGroupProps): React.ReactElement {
  function selectButton(button: HTMLButtonElement | undefined) {
    const color = button?.dataset.highlightColor;
    if (!button || !isHighlightColor(color)) return;
    button.focus();
    onChange(color);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
      return;
    }

    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-highlight-swatch-option]",
      ),
    );
    if (buttons.length === 0) return;

    const activeIndex = Math.max(
      0,
      buttons.findIndex(
        (button) =>
          button === document.activeElement ||
          button.getAttribute("aria-checked") === "true",
      ),
    );

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectButton(buttons[(activeIndex + 1) % buttons.length]);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectButton(buttons[(activeIndex - 1 + buttons.length) % buttons.length]);
        break;
      case "Home":
        event.preventDefault();
        selectButton(buttons[0]);
        break;
      case "End":
        event.preventDefault();
        selectButton(buttons[buttons.length - 1]);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("rw-highlight-color-swatch-group", className)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {HIGHLIGHT_COLOR_OPTIONS.map((option) => {
        const selected = value === option.color;
        const style: HighlightSwatchStyle = {
          "--hl-swatch-bg": tone === "dot" ? option.dotVar : option.fillVar,
        };

        return (
          <button
            key={option.color}
            ref={(node) => {
              if (selected) setForwardedRef(activeSwatchRef, node);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            tabIndex={selected ? 0 : -1}
            data-highlight-swatch-option
            data-highlight-color={option.color}
            data-size={size}
            data-touch-target={touchTarget || undefined}
            className={cn(
              "rw-highlight-color-swatch-button",
              focusRing,
              buttonClassName,
            )}
            style={style}
            onClick={() => onChange(option.color)}
          >
            {selected ? (
              <Check
                className="rw-highlight-color-swatch-check"
                size={12}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
