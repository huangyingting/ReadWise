import type { ReactNode } from "react";

/** One labelled value in a {@link MetricGrid}. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted text-[length:var(--text-sm)]">{label}</dt>
      <dd className="m-0 font-medium">{children}</dd>
    </div>
  );
}

/** Responsive 2–3 column definition grid for admin detail metrics. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)] m-0">{children}</dl>;
}
