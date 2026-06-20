"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const HINT_DISMISSED_KEY = "readwise:hint-dismissed";

/**
 * One-shot dismissible word-lookup / reading hint.
 * Hidden once the user dismisses it — persists across sessions via localStorage.
 */
export default function WordLookupHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(HINT_DISMISSED_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable — show hint once
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  }

  if (!visible) return null;

  return (
    <p className={cn("muted word-lookup-hint flex items-start gap-2")}>
      <span className="flex-1">
        Click a word to define it · Select text to highlight or add a note · Use{" "}
        <kbd style={{ fontFamily: "inherit", fontSize: "0.9em" }}>⌘/Ctrl+E</kbd> with a selection
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss hint"
        className="shrink-0 text-text-subtle hover:text-text transition-colors mt-px"
      >
        <X size={14} aria-hidden />
      </button>
    </p>
  );
}
