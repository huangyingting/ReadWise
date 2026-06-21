"use client";

/**
 * ReaderLayout (#153)
 *
 * Thin client wrapper around the `.reader-layout` two-column grid. Reads the
 * Tools open state from ReaderToolsProvider and reflects it as `data-tools-open`
 * so CSS can reserve the right-rail column at xl ONLY when the surface is open
 * (keeping the reading column at its measure width and avoiding a permanently
 * narrowed column / horizontal scroll). Server-rendered children (the reading
 * column + the Tools surface) pass straight through, so RSC content is untouched.
 */

import type { ReactNode } from "react";
import { useReaderTools } from "./ReaderToolsProvider";

export default function ReaderLayout({ children }: { children: ReactNode }) {
  const { open } = useReaderTools();
  return (
    <div className="reader-layout" data-tools-open={open ? "true" : "false"}>
      {children}
    </div>
  );
}
