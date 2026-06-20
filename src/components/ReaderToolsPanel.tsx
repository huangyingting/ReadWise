"use client";

/**
 * ReaderToolsPanel (M5, patched M9-B)
 *
 * Tabbed panel containing the four AI tools: Listen · Words · Quiz · Translate.
 * Owns activeTab + visited (Set of tabs fetched at least once).
 *
 * Key behaviors:
 *  - Panels stay MOUNTED once visited (display:none while hidden), so:
 *    · Audio keeps playing across tab switches (shared via ReaderAudioProvider)
 *    · Quiz answers / vocab saves persist in-session
 *  - Each panel triggers its own fetch on first mount
 *  - PanelContents is rendered ONCE — in the aside on desktop, in the sheet on
 *    mobile (NIR-M5-1: eliminated double API call per tab activation)
 *  - Mobile bottom-sheet: focus moves into sheet on open, Tab is focus-trapped,
 *    Escape closes and restores focus to the FAB (NIR-M5-2)
 *  - Auto-scroll in ArticleSpeech is gated on the Listen tab being active
 *  - Accessible: role="tablist", role="tab" aria-selected, role="tabpanel",
 *    roving tabindex, arrow-key navigation
 *
 * Desktop: renders as the sticky right rail (layout driven by .reader-tools-rail).
 * Mobile:  renders as a bottom sheet triggered by the "Tools" FAB.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Volume2, BookOpen, CircleCheck, Languages, Highlighter, Sparkles, X, Mic, Keyboard } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import ArticleSpeech from "./ArticleSpeech";
import ArticleVocabulary from "./ArticleVocabulary";
import ArticleQuiz from "./ArticleQuiz";
import ArticleTranslation from "./ArticleTranslation";
import ReaderNotesPanel from "./ReaderNotesPanel";
import { ReaderTutorProvider } from "./ReaderTutorProvider";
import ArticleTutor from "./ArticleTutor";
import ArticlePronunciation from "./ArticlePronunciation";
import ArticleDictation from "./ArticleDictation";
import { READER_BREAKPOINT } from "@/lib/breakpoints";

export type TabId = "listen" | "dictate" | "speak" | "words" | "quiz" | "translate" | "notes" | "ask";

const TABS: {
  id: TabId;
  label: string;
  icon: ReactNode;
  ariaLabel: string;
}[] = [
  {
    id: "listen",
    label: "Listen",
    icon: <Volume2 size={14} />,
    ariaLabel: "Listen tab",
  },
  {
    id: "dictate",
    label: "Dictate",
    icon: <Keyboard size={14} />,
    ariaLabel: "Dictate tab",
  },
  {
    id: "speak",
    label: "Speak",
    icon: <Mic size={14} />,
    ariaLabel: "Speak tab",
  },
  {
    id: "words",
    label: "Words",
    icon: <BookOpen size={14} />,
    ariaLabel: "Words tab",
  },
  {
    id: "quiz",
    label: "Quiz",
    icon: <CircleCheck size={14} />,
    ariaLabel: "Quiz tab",
  },
  {
    id: "translate",
    label: "Translate",
    icon: <Languages size={14} />,
    ariaLabel: "Translate tab",
  },
  {
    id: "notes",
    label: "Notes",
    icon: <Highlighter size={14} />,
    ariaLabel: "Notes tab",
  },
  {
    id: "ask",
    label: "Ask",
    icon: <Sparkles size={14} />,
    ariaLabel: "Ask tab",
  },
];

/**
 * Visual grouping for the tab rail. Groups are purely presentational;
 * keyboard navigation (arrow keys) still moves linearly through TABS.
 *
 * Grouping:
 *   Audio   — Listen, Dictate, Speak  (narration + dictation + pronunciation)
 *   Study   — Words, Quiz             (vocabulary + comprehension)
 *   Content — Translate, Notes, Ask   (translation + notes + AI tutor)
 */
const TAB_GROUPS: Array<{
  /** All groups have a label for visual clarity. */
  label: string;
  ids: TabId[];
}> = [
  { label: "Audio", ids: ["listen", "dictate", "speak"] },
  { label: "Study", ids: ["words", "quiz"] },
  { label: "Content", ids: ["translate", "notes", "ask"] },
];

type SupportedLanguage = {
  code: string;
  label: string;
};

interface ReaderToolsPanelProps {
  articleId: string;
  languages: SupportedLanguage[];
  /** Article body as plain text — used by the Speak tab sentence splitter. */
  plainText?: string;
}

function TabBar({
  activeTab,
  onSelect,
  tabListRef,
}: {
  activeTab: TabId | null;
  onSelect: (id: TabId) => void;
  tabListRef: React.RefObject<HTMLDivElement | null>;
}) {
  function handleKeyDown(e: React.KeyboardEvent, currentIndex: number) {
    const list = tabListRef.current;
    if (!list) return;
    const buttons = Array.from(
      list.querySelectorAll<HTMLButtonElement>("[role='tab']"),
    );
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (currentIndex + 1) % TABS.length;
      buttons[next]?.focus();
      onSelect(TABS[next].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (currentIndex - 1 + TABS.length) % TABS.length;
      buttons[prev]?.focus();
      onSelect(TABS[prev].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      buttons[0]?.focus();
      onSelect(TABS[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = TABS.length - 1;
      buttons[last]?.focus();
      onSelect(TABS[last].id);
    }
  }

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label="Reading tools"
      className="reader-tabs"
    >
      {TAB_GROUPS.map((group, gi) => {
        const groupTabs = group.ids
          .map((id) => TABS.find((t) => t.id === id)!)
          .filter(Boolean);
        return (
          <div
            key={group.label ?? `solo-${gi}`}
            role="presentation"
            className="reader-tab-group reader-tab-group--labeled"
          >
            <span
              className="reader-tab-group-label"
              role="presentation"
              aria-hidden="true"
            >
              {group.label}
            </span>
            <div role="presentation" className="reader-tab-group-row">
              {groupTabs.map(({ id, label, icon, ariaLabel }) => {
                const globalIndex = TABS.findIndex((t) => t.id === id);
                const isActive = activeTab === id;
                // WAI-ARIA roving-tabindex: when no tab is active, the first tab
                // gets tabIndex=0 so keyboard users can enter the tablist (#52).
                // That same first tab also gets aria-selected="true" so screen
                // readers always hear exactly one selected tab (#70).
                const isFirst = globalIndex === 0;
                const isCurrent = isActive || (activeTab === null && isFirst);
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`reader-tab-${id}`}
                    aria-selected={isCurrent}
                    aria-controls={`reader-panel-${id}`}
                    tabIndex={isCurrent ? 0 : -1}
                    aria-label={ariaLabel}
                    onClick={() => onSelect(id)}
                    onKeyDown={(e) => handleKeyDown(e, globalIndex)}
                    className={cn("reader-tab-btn", focusRing)}
                  >
                    <span aria-hidden="true">{icon}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PanelContents({
  activeTab,
  visited,
  articleId,
  languages,
  plainText,
}: {
  activeTab: TabId | null;
  visited: Set<TabId>;
  articleId: string;
  languages: SupportedLanguage[];
  plainText: string;
}) {
  return (
    <div className="reader-tab-panels">
      {/* All panel containers are always mounted so aria-controls references exist.
          Content is lazy-loaded on first tab activation (stays mounted once visited). */}
      <div
        id="reader-panel-listen"
        role="tabpanel"
        aria-labelledby="reader-tab-listen"
        className="reader-tab-panel"
        hidden={activeTab !== "listen"}
      >
        {visited.has("listen") && (
          <ArticleSpeech articleId={articleId} active={activeTab === "listen"} />
        )}
      </div>

      <div
        id="reader-panel-dictate"
        role="tabpanel"
        aria-labelledby="reader-tab-dictate"
        className="reader-tab-panel"
        hidden={activeTab !== "dictate"}
      >
        {visited.has("dictate") && (
          <ArticleDictation
            articleId={articleId}
            plainText={plainText}
            active={activeTab === "dictate"}
          />
        )}
      </div>

      <div
        id="reader-panel-speak"
        role="tabpanel"
        aria-labelledby="reader-tab-speak"
        className="reader-tab-panel"
        hidden={activeTab !== "speak"}
      >
        {visited.has("speak") && (
          <ArticlePronunciation
            articleId={articleId}
            plainText={plainText}
            active={activeTab === "speak"}
          />
        )}
      </div>

      <div
        id="reader-panel-words"
        role="tabpanel"
        aria-labelledby="reader-tab-words"
        className="reader-tab-panel"
        hidden={activeTab !== "words"}
      >
        {visited.has("words") && (
          <ArticleVocabulary articleId={articleId} active={activeTab === "words"} />
        )}
      </div>

      <div
        id="reader-panel-quiz"
        role="tabpanel"
        aria-labelledby="reader-tab-quiz"
        className="reader-tab-panel"
        hidden={activeTab !== "quiz"}
      >
        {visited.has("quiz") && (
          <ArticleQuiz articleId={articleId} active={activeTab === "quiz"} />
        )}
      </div>

      <div
        id="reader-panel-translate"
        role="tabpanel"
        aria-labelledby="reader-tab-translate"
        className="reader-tab-panel"
        hidden={activeTab !== "translate"}
      >
        {visited.has("translate") && (
          <ArticleTranslation
            articleId={articleId}
            languages={languages}
            active={activeTab === "translate"}
          />
        )}
      </div>

      {/* Notes panel: always mounted (data loaded eagerly by ReaderHighlightsProvider) */}
      <div
        id="reader-panel-notes"
        role="tabpanel"
        aria-labelledby="reader-tab-notes"
        className="reader-tab-panel"
        hidden={activeTab !== "notes"}
      >
        <ReaderNotesPanel />
      </div>

      <div
        id="reader-panel-ask"
        role="tabpanel"
        aria-labelledby="reader-tab-ask"
        className="reader-tab-panel"
        hidden={activeTab !== "ask"}
      >
        {visited.has("ask") && (
          <ReaderTutorProvider articleId={articleId}>
            <ArticleTutor active={activeTab === "ask"} />
          </ReaderTutorProvider>
        )}
      </div>
    </div>
  );
}

/** Selects all focusable, non-disabled elements within a container. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export default function ReaderToolsPanel({
  articleId,
  languages,
  plainText = "",
}: ReaderToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [visited, setVisited] = useState<Set<TabId>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * NIR-M5-1: true once the media query fires below 1100px.
   * Controls whether PanelContents lives in the aside or the sheet so it is
   * never mounted in both places simultaneously.
   */
  const [isMobile, setIsMobile] = useState(false);

  // Separate refs per TabBar so they don't clobber each other on unmount.
  const asideTabListRef = useRef<HTMLDivElement | null>(null);
  const sheetTabListRef = useRef<HTMLDivElement | null>(null);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  /** FAB button — focus is restored here when the sheet closes (NIR-M5-2). */
  const fabRef = useRef<HTMLButtonElement | null>(null);
  /** First interactive element in the sheet — receives focus on open (NIR-M5-2). */
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const activateTab = useCallback((id: TabId) => {
    setActiveTab(id);
    setVisited((prev) => {
      if (prev.has(id)) return prev;
      return new Set([...prev, id]);
    });
  }, []);

  // NIR-M5-1: track viewport width to decide which container owns PanelContents.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${READER_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // NIR-M5-2: body scroll lock + focus management + Tab focus-trap.
  useEffect(() => {
    if (!sheetOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the sheet.
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSheet();
        return;
      }
      if (e.key === "Tab" && sheetRef.current) {
        const focusable = getFocusable(sheetRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !sheetRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !sheetRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  function closeSheet() {
    setSheetOpen(false);
    // Restore focus to the FAB that opened the sheet.
    requestAnimationFrame(() => fabRef.current?.focus());
  }

  function handleSheetOpen() {
    setSheetOpen(true);
    if (!activeTab) activateTab("listen");
  }

  const panelContents = (
    <PanelContents
      activeTab={activeTab}
      visited={visited}
      articleId={articleId}
      languages={languages}
      plainText={plainText}
    />
  );

  return (
    <>
      {/* ---- Desktop: sticky right rail ---- */}
      <aside
        className="reader-tools-rail"
        aria-label="Reading tools"
      >
        <h2 className="reader-tools-heading">Reading tools</h2>
        <TabBar
          activeTab={activeTab}
          onSelect={activateTab}
          tabListRef={asideTabListRef}
        />
        {/* NIR-M5-1: panels live here on desktop only */}
        {!isMobile && panelContents}
      </aside>

      {/* ---- Mobile: FAB trigger ---- */}
      <button
        ref={fabRef}
        type="button"
        aria-label="Open AI learning tools"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={handleSheetOpen}
        className={cn("reader-tools-fab", focusRing)}
      >
        <Sparkles size={16} aria-hidden="true" />
        Learn
      </button>

      {/* ---- Mobile: bottom sheet ---- */}
      {sheetOpen ? (
        <>
          {/* Scrim */}
          <div
            className="reader-bottom-sheet-scrim"
            aria-hidden="true"
            onClick={closeSheet}
          />

          {/* Sheet */}
          <div
            ref={sheetRef}
            role="dialog"
            aria-label="Reading tools"
            aria-modal="true"
            className="reader-bottom-sheet"
          >
            <div className="reader-bottom-sheet-handle" aria-hidden="true" />
            <div className="reader-bottom-sheet-header">
              <p className="reader-bottom-sheet-title">Reading tools</p>
              {/* closeButtonRef: first focus target when sheet opens */}
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close reading tools"
                onClick={closeSheet}
                className={cn("reader-icon-btn", focusRing)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="reader-bottom-sheet-body">
              <TabBar
                activeTab={activeTab}
                onSelect={activateTab}
                tabListRef={sheetTabListRef}
              />
              {/* NIR-M5-1: panels live here on mobile only */}
              {isMobile && panelContents}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
