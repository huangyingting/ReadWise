"use client";

/**
 * ReaderTools (#153)
 *
 * The six practice tools (Words · Quiz · Dictate · Speak · Notes · Ask) rendered
 * as a tab system. Extracted from the former ArticleStudySection so the SAME
 * single mounted instance can appear as a right rail (xl) or a bottom sheet
 * (<xl) via ReaderToolsSurface — there is exactly one of these on the page.
 *
 * Active tab + visited set live in ReaderToolsProvider (shared with the toolbar
 * Tools button and the in-flow anchor), so panels lazy-mount on first activation
 * and stay mounted afterwards — in-progress quiz answers / tutor chat / dictation
 * progress survive tab switches AND toggling the surface open/closed.
 */

import { useRef, type ReactNode } from "react";
import { BookOpen, CircleCheck, Keyboard, Mic, Highlighter, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { useReaderTools, type ToolTabId } from "./ReaderToolsProvider";
import { useRovingTabindex } from "@/lib/use-roving-tabindex";
import ArticleVocabulary from "./ArticleVocabulary";
import ArticleQuiz from "./ArticleQuiz";
import ArticleDictation from "./ArticleDictation";
import ArticlePronunciation from "./ArticlePronunciation";
import ReaderNotesPanel from "./reader/ReaderNotesPanel";
import { ReaderTutorProvider } from "./ReaderTutorProvider";
import ArticleTutor from "./ArticleTutor";
import ReaderPanelErrorBoundary from "./ReaderPanelErrorBoundary";

export const TOOL_TABS: {
  id: ToolTabId;
  label: string;
  icon: ReactNode;
  hint: string;
}[] = [
  { id: "words", label: "Words", icon: <BookOpen size={16} />, hint: "Study AI-extracted vocabulary and save words" },
  { id: "quiz", label: "Quiz", icon: <CircleCheck size={16} />, hint: "Test your comprehension" },
  { id: "dictate", label: "Dictate", icon: <Keyboard size={16} />, hint: "Type what you hear" },
  { id: "speak", label: "Speak", icon: <Mic size={16} />, hint: "Get pronunciation feedback" },
  { id: "notes", label: "Notes", icon: <Highlighter size={16} />, hint: "Review your highlights and notes" },
  { id: "ask", label: "Ask", icon: <Sparkles size={16} />, hint: "Ask the AI tutor about this article" },
];

export default function ReaderTools({
  articleId,
  plainText,
}: {
  articleId: string;
  plainText: string;
}) {
  const { open, activeTab, visited, activate, currentBlock } = useReaderTools();
  const currentBlockText = currentBlock?.text;
  const tabListRef = useRef<HTMLDivElement | null>(null);

  const { handleKeyDown } = useRovingTabindex(tabListRef, {
    selector: "[role='tab']",
    vertical: true,
    homeEnd: true,
    onNavigate: (i) => activate(TOOL_TABS[i].id),
  });

  return (
    <div className="reader-tools">
      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Choose a practice tool"
        className="article-study-tabs"
      >
        {TOOL_TABS.map(({ id, label, icon, hint }, i) => {
          const isActive = activeTab === id;
          return (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              role="tab"
              id={`study-tab-${id}`}
              aria-selected={isActive}
              aria-controls={`study-panel-${id}`}
              tabIndex={isActive ? 0 : -1}
              title={hint}
              onClick={() => activate(id)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              leadingIcon={<span aria-hidden="true">{icon}</span>}
              className="article-study-tab"
            >
              {label}
            </Button>
          );
        })}
      </div>

      <div className="article-study-panels">
        <div
          id="study-panel-words"
          role="tabpanel"
          aria-labelledby="study-tab-words"
          className="article-study-panel"
          hidden={activeTab !== "words"}
        >
          {visited.has("words") && (
            <ReaderPanelErrorBoundary label="Words">
              <ArticleVocabulary articleId={articleId} active={open && activeTab === "words"} />
            </ReaderPanelErrorBoundary>
          )}
        </div>

        <div
          id="study-panel-quiz"
          role="tabpanel"
          aria-labelledby="study-tab-quiz"
          className="article-study-panel"
          hidden={activeTab !== "quiz"}
        >
          {visited.has("quiz") && (
            <ReaderPanelErrorBoundary label="Quiz">
              <ArticleQuiz articleId={articleId} active={open && activeTab === "quiz"} />
            </ReaderPanelErrorBoundary>
          )}
        </div>

        <div
          id="study-panel-dictate"
          role="tabpanel"
          aria-labelledby="study-tab-dictate"
          className="article-study-panel"
          hidden={activeTab !== "dictate"}
        >
          {visited.has("dictate") && (
            <ReaderPanelErrorBoundary label="Dictate">
              <ArticleDictation
                articleId={articleId}
                plainText={plainText}
                active={open && activeTab === "dictate"}
              />
            </ReaderPanelErrorBoundary>
          )}
        </div>

        <div
          id="study-panel-speak"
          role="tabpanel"
          aria-labelledby="study-tab-speak"
          className="article-study-panel"
          hidden={activeTab !== "speak"}
        >
          {visited.has("speak") && (
            <ReaderPanelErrorBoundary label="Speak">
              <ArticlePronunciation
                articleId={articleId}
                plainText={plainText}
                active={open && activeTab === "speak"}
                currentBlockText={currentBlockText}
              />
            </ReaderPanelErrorBoundary>
          )}
        </div>

        <div
          id="study-panel-notes"
          role="tabpanel"
          aria-labelledby="study-tab-notes"
          className="article-study-panel"
          hidden={activeTab !== "notes"}
        >
          <ReaderPanelErrorBoundary label="Notes">
            <ReaderNotesPanel />
          </ReaderPanelErrorBoundary>
        </div>

        <div
          id="study-panel-ask"
          role="tabpanel"
          aria-labelledby="study-tab-ask"
          className="article-study-panel"
          hidden={activeTab !== "ask"}
        >
          {visited.has("ask") && (
            <ReaderPanelErrorBoundary label="Ask">
              <ReaderTutorProvider articleId={articleId} paragraphContext={currentBlockText}>
                <ArticleTutor active={open && activeTab === "ask"} />
              </ReaderTutorProvider>
            </ReaderPanelErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
