"use client";

/**
 * ReaderToolsProvider (#153)
 *
 * Shared context for the unified responsive reader Tools surface. Mirrors the
 * ReaderAudioProvider pattern: a single provider hoists the open/closed state of
 * the Tools surface AND the active practice tab + visited set, so they survive
 * toggling the surface and switching breakpoints.
 *
 * Consumers:
 *  - ReaderControls — the "Tools" toolbar button toggles the surface.
 *  - ArticleStudySection — the in-flow "Practice what you read" anchor/CTA opens
 *    the surface (optionally to a specific tool).
 *  - ReaderLayout — applies `data-tools-open` so the xl grid reserves the rail.
 *  - ReaderToolsSurface / ReaderTools — render the (single) mounted tab system
 *    driven by `activeTab`/`visited` held here, so in-progress quiz answers /
 *    tutor chat / dictation state persist across open/close and tab switches.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { ReadingBlock } from "@/components/reader/useCurrentReadingBlock";
import { STORAGE_KEYS } from "@/lib/storage-keys";

export type ToolTabId = "words" | "quiz" | "dictate" | "speak" | "notes" | "ask";

const TOOL_TAB_IDS: readonly ToolTabId[] = [
  "words",
  "quiz",
  "dictate",
  "speak",
  "notes",
  "ask",
];

/** localStorage key used to remember the last-used practice tab across reloads. */
const ACTIVE_TAB_STORAGE_KEY = STORAGE_KEYS.READER_TOOLS_TAB;

function isToolTabId(value: unknown): value is ToolTabId {
  return typeof value === "string" && TOOL_TAB_IDS.includes(value as ToolTabId);
}

type ReaderToolsContextValue = {
  /** Whether the Tools surface (rail on xl / sheet on <xl) is open. */
  open: boolean;
  /** Currently selected practice tab. */
  activeTab: ToolTabId;
  /** Tabs that have been activated at least once (lazy-mount-keep-alive set). */
  visited: ReadonlySet<ToolTabId>;
  /** Toggle the surface open/closed (the toolbar Tools button). */
  toggle: () => void;
  /** Open the surface, optionally jumping straight to a specific tool. */
  openTools: (tab?: ToolTabId) => void;
  /** Close the surface. */
  closeTools: () => void;
  /** Select a tab (marks it visited). Does not change open state. */
  activate: (tab: ToolTabId) => void;
  /**
   * The most-visible prose block the reader is currently looking at (#376).
   * Null before the tracker mounts or when IntersectionObserver is unavailable.
   */
  currentBlock: ReadingBlock | null;
  /** Used by ReaderReadingBlockTracker to push updates into context. */
  setCurrentBlock: (block: ReadingBlock | null) => void;
};

const ReaderToolsContext = createContext<ReaderToolsContextValue | null>(null);

export function ReaderToolsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ToolTabId>("words");
  // Start with an EMPTY visited set so no panel (notably ArticleVocabulary) mounts
  // — and thus fires its POST — on plain reader load. A tab is only marked visited
  // when it is activated or when the surface is opened on that tab (#210).
  const [visited, setVisited] = useState<Set<ToolTabId>>(
    () => new Set<ToolTabId>(),
  );
  const [currentBlock, setCurrentBlock] = useState<ReadingBlock | null>(null);
  const pathname = usePathname();

  const activate = useCallback((tab: ToolTabId) => {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, []);

  const openTools = useCallback(
    (tab?: ToolTabId) => {
      if (tab) activate(tab);
      setOpen(true);
    },
    [activate],
  );

  const closeTools = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  // Restore the last-used tab from localStorage on mount. Done in an effect (not
  // a lazy initializer) to avoid an SSR/client hydration mismatch. Restoring the
  // tab does NOT mark it visited, so no panel fetch fires until the surface opens.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (isToolTabId(stored)) setActiveTab(stored);
    } catch {
      // Ignore storage access errors (private mode, disabled storage).
    }
  }, []);

  // Persist the active tab so it is remembered across reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Ignore storage access errors.
    }
  }, [activeTab]);

  // When the surface opens, mark the active tab visited so its panel mounts. This
  // keeps the auto-fire suppression (empty initial visited set) while still
  // loading the current tab the moment the overlay is opened.
  useEffect(() => {
    if (!open) return;
    setVisited((prev) =>
      prev.has(activeTab) ? prev : new Set([...prev, activeTab]),
    );
  }, [open, activeTab]);

  // Browser/hardware Back should close the overlay instead of leaving the article
  // (#210). Push a history entry on open and listen for popstate; on a normal
  // close (X/Esc) pop the entry we pushed so we don't accumulate stray entries.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    window.history.pushState({ readerTools: true }, "");

    function onPopState() {
      setOpen(false);
    }
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      // If we closed via X/Esc (not via Back), our pushed entry is still on top —
      // pop it. If we closed because Back was pressed, the browser already popped
      // it and history.state no longer carries the marker, so we skip.
      const state = window.history.state as { readerTools?: boolean } | null;
      if (state?.readerTools) {
        window.history.back();
      }
    };
  }, [open]);

  // Close the surface on client-side route change (acceptance: route-change
  // closes the sheet). The provider only mounts on /reader/*, so this also
  // guards re-renders within the route.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <ReaderToolsContext.Provider
      value={{ open, activeTab, visited, toggle, openTools, closeTools, activate, currentBlock, setCurrentBlock }}
    >
      {children}
    </ReaderToolsContext.Provider>
  );
}

export function useReaderTools(): ReaderToolsContextValue {
  const ctx = useContext(ReaderToolsContext);
  if (!ctx) {
    throw new Error("useReaderTools must be used within ReaderToolsProvider");
  }
  return ctx;
}
