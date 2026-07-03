import * as React from "react";
import { cn } from "@/lib/cn";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

function joinDescribedBy(
  ...ids: Array<string | null | undefined | false>
): string | undefined {
  return ids.filter(Boolean).join(" ") || undefined;
}

export function Label({ required, className, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "font-medium text-text text-[length:var(--text-sm)]",
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden className="ml-0.5 text-danger-text">
          *
        </span>
      )}
    </label>
  );
}

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  /** Help text shown under the label. */
  hint?: React.ReactNode;
  /** Error message; presence also flags the control invalid. */
  error?: React.ReactNode;
  required?: boolean;
  /** The form control. If a single element, id + aria-describedby are wired automatically. */
  children: React.ReactNode;
}

function cloneFieldControl(
  children: React.ReactNode,
  controlId: string,
  describedBy: string | undefined,
  invalid: boolean | undefined,
): React.ReactNode {
  if (!React.isValidElement(children)) {
    return children;
  }

  const child = children as React.ReactElement<Record<string, unknown>>;
  return React.cloneElement(child, {
    id: child.props.id ?? controlId,
    "aria-describedby": joinDescribedBy(
      child.props["aria-describedby"] as string | undefined,
      describedBy,
    ),
    invalid: child.props.invalid ?? invalid,
  });
}

/**
 * Label + control + hint/error wrapper. Wires `htmlFor`/`id` and
 * `aria-describedby`, and reserves the error row height to avoid layout shift.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...props
}: FieldProps) {
  const reactId = React.useId();
  const controlId = `field-${reactId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = joinDescribedBy(hintId, errorId);
  const control = cloneFieldControl(
    children,
    controlId,
    describedBy,
    error ? true : undefined,
  );

  return (
    <div
      className={cn("flex flex-col gap-[var(--space-2)]", className)}
      {...props}
    >
      {label && (
        <Label htmlFor={controlId} required={required}>
          {label}
        </Label>
      )}
      {hint && (
        <p id={hintId} className="text-text-subtle text-[length:var(--text-xs)]">
          {hint}
        </p>
      )}
      {control}
      <p
        id={errorId}
        className="min-h-[1.25em] text-danger-text text-[length:var(--text-sm)]"
        role={error ? "alert" : undefined}
      >
        {error}
      </p>
    </div>
  );
}
