"use client";

import type { ReactNode } from "react";
import { CircleOff, BookOpen } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * ReaderToolPanelState
 *
 * Shared presentational states for reader study-tool panels:
 * loading, fallback/unavailable, empty, and error.
 */

export function PanelLoading({ message }: { message: string }) {
  return (
    <div className="reader-tools-panel-state" role="status">
      <Spinner size="lg" />
      <p className="muted">{message}</p>
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <p className="vocabulary-error" role="alert">
      {message}
    </p>
  );
}

export function PanelFallback({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="reader-tools-panel-state">
      <CircleOff size={28} className="text-text-subtle" aria-hidden />
      <p className="font-semibold m-0">{title}</p>
      <p className="muted m-0 max-w-[40ch]">{description}</p>
    </div>
  );
}

export function PanelEmpty({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="reader-tools-panel-state">
      <BookOpen size={28} className="text-text-subtle" aria-hidden />
      <p className="font-semibold m-0">{title}</p>
      <p className="muted m-0 max-w-[40ch]">{description}</p>
    </div>
  );
}
