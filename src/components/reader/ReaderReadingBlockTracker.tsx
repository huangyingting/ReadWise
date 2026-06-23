"use client";

/**
 * ReaderReadingBlockTracker (#376)
 *
 * A non-rendering client component that locates the sanitized prose element,
 * runs `useCurrentReadingBlock` on it, and pushes the result into
 * `ReaderToolsContext` via `setCurrentBlock`.
 *
 * Placed inside the reader column (near BilingualBody) so it mounts after the
 * prose is already in the DOM. Renders null — purely a side-effect component.
 *
 * SAFETY: Uses `document.querySelector` once on mount (not on every render),
 * so it never mutates prose content. Gracefully handles SSR / environments
 * where IntersectionObserver is unavailable (the hook returns null silently).
 */

import { useEffect, useState } from "react";
import {
  useCurrentReadingBlock,
} from "@/components/reader/useCurrentReadingBlock";
import { useReaderTools } from "@/components/ReaderToolsProvider";

export default function ReaderReadingBlockTracker() {
  const [proseEl, setProseEl] = useState<HTMLElement | null>(null);
  const block = useCurrentReadingBlock(proseEl);
  const { setCurrentBlock } = useReaderTools();

  // Locate the `.word-lookup-prose` element once after mount.
  // WordLookup renders it synchronously before this component mounts
  // (both live in the same React tree under the same Suspense boundary).
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".word-lookup-prose");
    setProseEl(el);
  }, []);

  // Sync block changes into the shared ReaderToolsProvider context so that
  // tools (Speak, Ask) can reference the current paragraph without DOM access.
  useEffect(() => {
    setCurrentBlock(block);
  }, [block, setCurrentBlock]);

  return null;
}
