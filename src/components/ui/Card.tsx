import * as React from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hover elevation + lift; use for link/clickable cards. */
  interactive?: boolean;
}

export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]",
        "p-[var(--space-5)] sm:p-[var(--space-6)]",
        interactive &&
          cn(
            "transition-[box-shadow,border-color,transform] cursor-pointer",
            "[transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
            "hover:shadow-[var(--shadow-md)] hover:border-border-strong hover:-translate-y-0.5",
          ),
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-[var(--space-1)]", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-[family-name:var(--font-display)] font-semibold text-text",
        "text-[length:var(--text-xl)] leading-[var(--leading-snug)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardMeta({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-text-subtle text-[length:var(--text-sm)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-[var(--space-4)] text-text", className)}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-[var(--space-5)] flex items-center gap-[var(--space-3)]",
        className,
      )}
      {...props}
    />
  );
}
