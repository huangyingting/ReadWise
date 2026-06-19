"use client";

/**
 * ReaderToolsPanel (M5)
 *
 * Tabbed panel containing the four AI tools: Listen · Words · Quiz · Translate.
 * Owns activeTab + visited (Set of tabs fetched at least once).
 *
 * Key behaviors:
 *  - Panels stay MOUNTED once visited (display:none while hidden), so:
 *    · Audio keeps playing across tab switches (shared via ReaderAudioProvider)
 *    · Quiz answers / vocab saves persist in-session
 *  - Each panel triggers its own fetch on first mount
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
import { Volume2, BookOpen, CircleCheck, Languages, Wrench, X } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import ArticleSpeech from "./ArticleSpeech";
import ArticleVocabulary from "./ArticleVocabulary";
import ArticleQuiz from "./ArticleQuiz";
import ArticleTranslation from "./ArticleTranslation";

export type TabId = "listen" | "words" | "quiz" | "translate";

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
];

type SupportedLanguage = {
  code: string;
  label: string;
};

interface ReaderToolsPanelProps {
  articleId: string;
  languages: SupportedLanguage[];
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
      {TABS.map(({ id, label, icon, ariaLabel }, i) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`reader-tab-${id}`}
            aria-selected={isActive}
            aria-controls={`reader-panel-${id}`}
            tabIndex={isActive ? 0 : -1}
            aria-label={ariaLabel}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn("reader-tab-btn", focusRing)}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
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
}: {
  activeTab: TabId | null;
  visited: Set<TabId>;
  articleId: string;
  languages: SupportedLanguage[];
}) {
  return (
    <div className="reader-tab-panels">
      {/* Each panel renders once visited; hidden while not active */}
      {visited.has("listen") && (
        <div
          id="reader-panel-listen"
          role="tabpanel"
          aria-labelledby="reader-tab-listen"
          className="reader-tab-panel"
          hidden={activeTab !== "listen"}
        >
          <ArticleSpeech articleId={articleId} active={activeTab === "listen"} />
        </div>
      )}

      {visited.has("words") && (
        <div
          id="reader-panel-words"
          role="tabpanel"
          aria-labelledby="reader-tab-words"
          className="reader-tab-panel"
          hidden={activeTab !== "words"}
        >
          <ArticleVocabulary articleId={articleId} active={activeTab === "words"} />
        </div>
      )}

      {visited.has("quiz") && (
        <div
          id="reader-panel-quiz"
          role="tabpanel"
          aria-labelledby="reader-tab-quiz"
          className="reader-tab-panel"
          hidden={activeTab !== "quiz"}
        >
          <ArticleQuiz articleId={articleId} active={activeTab === "quiz"} />
        </div>
      )}

      {visited.has("translate") && (
        <div
          id="reader-panel-translate"
          role="tabpanel"
          aria-labelledby="reader-tab-translate"
          className="reader-tab-panel"
          hidden={activeTab !== "translate"}
        >
          <ArticleTranslation
            articleId={articleId}
            languages={languages}
            active={activeTab === "translate"}
          />
        </div>
      )}
    </div>
  );
}

export default function ReaderToolsPanel({
  articleId,
  languages,
}: ReaderToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [visited, setVisited] = useState<Set<TabId>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);

  const activateTab = useCallback((id: TabId) => {
    setActiveTab(id);
    setVisited((prev) => {
      if (prev.has(id)) return prev;
      return new Set([...prev, id]);
    });
  }, []);

  // Mobile sheet: focus-trap + body scroll lock
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first tab button when sheet opens
    requestAnimationFrame(() => {
      firstFocusRef.current?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSheetOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  function handleSheetOpen() {
    setSheetOpen(true);
    // Open to the last active tab or default to "listen"
    if (!activeTab) activateTab("listen");
  }

  function handleScrimClick() {
    setSheetOpen(false);
  }

  const panelContents = (
    <PanelContents
      activeTab={activeTab}
      visited={visited}
      articleId={articleId}
      languages={languages}
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
          onSelect={(id) => activateTab(id)}
          tabListRef={tabListRef}
        />
        {panelContents}
      </aside>

      {/* ---- Mobile: FAB trigger ---- */}
      <button
        type="button"
        aria-label="Open reading tools"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={handleSheetOpen}
        className={cn("reader-tools-fab", focusRing)}
      >
        <Wrench size={16} aria-hidden="true" />
        Tools
      </button>

      {/* ---- Mobile: bottom sheet ---- */}
      {sheetOpen ? (
        <>
          {/* Scrim */}
          <div
            className="reader-bottom-sheet-scrim"
            aria-hidden="true"
            onClick={handleScrimClick}
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
              <button
                type="button"
                aria-label="Close reading tools"
                onClick={() => setSheetOpen(false)}
                className={cn("reader-icon-btn", focusRing)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="reader-bottom-sheet-body">
              {/* Tabs (shared state — switching in sheet updates rail too) */}
              <TabBar
                activeTab={activeTab}
                onSelect={(id) => {
                  activateTab(id);
                }}
                tabListRef={tabListRef}
              />
              {panelContents}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
