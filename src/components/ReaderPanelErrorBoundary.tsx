"use client";

/**
 * ReaderPanelErrorBoundary (#224)
 *
 * A tiny sub-tree error boundary that wraps each of the six reader tool panels
 * (Words · Quiz · Dictate · Speak · Notes · Ask). Route-level RSC `error.tsx`
 * files don't catch client render errors, so without this a crash in one panel
 * would unmount the whole reader. This contains the blast radius: the failing
 * panel shows a compact "This tool hit an error" fallback with a retry, while
 * the rest of the reader keeps working.
 *
 * Class component because React error boundaries require `componentDidCatch` /
 * `getDerivedStateFromError`. Token-styled + reduced-motion friendly (no
 * animations).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Human label for the wrapped tool, used in the fallback copy + logs. */
  label: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ReaderPanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Report to the structured server logs via the same beacon the global
    // error boundary uses (client-safe — never throws).
    try {
      const url =
        typeof window !== "undefined"
          ? window.location.origin + window.location.pathname
          : undefined;
      const stack = [error.stack, info.componentStack]
        .filter(Boolean)
        .join("\n");
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message || "Reader panel render error",
          source: `reader-panel:${this.props.label}`,
          stack: stack || undefined,
          url,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Reporting must never throw.
    }
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" className="reader-panel-error">
          <p className="reader-panel-error-text">
            This tool hit an error and couldn&apos;t be shown.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="reader-panel-error-retry"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
