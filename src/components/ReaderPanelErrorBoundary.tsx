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
import { reportClientError } from "@/lib/client-error-reporter";
import { Button } from "@/components/ui";

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
    const stack = [error.stack, info.componentStack]
      .filter(Boolean)
      .join("\n");
    reportClientError({
      message: error.message || "Reader panel render error",
      source: `reader-panel:${this.props.label}`,
      stack: stack || undefined,
    });
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
          <Button
            variant="outline"
            size="sm"
            onClick={this.reset}
            className="reader-panel-error-retry"
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
