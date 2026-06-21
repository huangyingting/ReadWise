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

export type ToolTabId = "words" | "quiz" | "dictate" | "speak" | "notes" | "ask";

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
};

const ReaderToolsContext = createContext<ReaderToolsContextValue | null>(null);

export function ReaderToolsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ToolTabId>("words");
  const [visited, setVisited] = useState<Set<ToolTabId>>(
    () => new Set<ToolTabId>(["words"]),
  );
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

  // Close the surface on client-side route change (acceptance: route-change
  // closes the sheet). The provider only mounts on /reader/*, so this also
  // guards re-renders within the route.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <ReaderToolsContext.Provider
      value={{ open, activeTab, visited, toggle, openTools, closeTools, activate }}
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
