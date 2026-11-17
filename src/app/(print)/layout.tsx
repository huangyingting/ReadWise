import type { ReactNode } from "react";

/**
 * Route group for printable pages (#1306). Deliberately has no app shell
 * (sidebar, header, bottom bar) so printed pages are chrome-free; each page
 * keeps its own session gate.
 */
export default function PrintGroupLayout({ children }: { children: ReactNode }) {
  return <div className="print-page min-h-screen bg-bg">{children}</div>;
}
