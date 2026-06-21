"use client";

/**
 * ArticleStudySection (方案 1)
 *
 * Full-width, in-flow "read-after" section rendered at the end of the article
 * (before "Keep reading"). Replaces the old floating tools drawer for the
 * study/practice tools — they now live in the natural page flow with the same
 * editorial section styling, so space-hungry tools get the full reading width.
 *
 * Tools: Words · Quiz · Dictate · Speak · Notes · Ask
 * (Listen lives in the top ReaderControls pill; Translate is the inline
 *  Bilingual toggle above the prose.)
 *
 * Panels are lazy-loaded on first activation and stay mounted once visited so
 * in-progress quiz answers / tutor chat survive tab switches.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { BookOpen, CircleCheck, Keyboard, Mic, Highlighter, Sparkles } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import ArticleVocabulary from "./ArticleVocabulary";
import ArticleQuiz from "./ArticleQuiz";
import ArticleDictation from "./ArticleDictation";
import ArticlePronunciation from "./ArticlePronunciation";
import ReaderNotesPanel from "./ReaderNotesPanel";
import { ReaderTutorProvider } from "./ReaderTutorProvider";
import ArticleTutor from "./ArticleTutor";

type TabId = "words" | "quiz" | "dictate" | "speak" | "notes" | "ask";

const TABS: {
  id: TabId;
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

export default function ArticleStudySection({
  articleId,
  plainText,
}: {
  articleId: string;
  plainText: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("words");
  const [visited, setVisited] = useState<Set<TabId>>(new Set(["words"]));
  const tabListRef = useRef<HTMLDivElement | null>(null);

  const activate = useCallback((id: TabId) => {
    setActiveTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const list = tabListRef.current;
    if (!list) return;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>("[role='tab']"));
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    buttons[nextIndex]?.focus();
    activate(TABS[nextIndex].id);
  }

  return (
    <section className="article-study" aria-label="Practice and study">
      <h2 className="article-study-title">Practice what you read</h2>
      <p className="muted article-study-subtitle">
        Reinforce the article with vocabulary, a quiz, listening &amp; speaking practice, your notes, and an AI tutor.
      </p>

      <div className="article-study-card">
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="Practice tools"
          className="article-study-tabs"
        >
          {TABS.map(({ id, label, icon, hint }, i) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`study-tab-${id}`}
                aria-selected={isActive}
                aria-controls={`study-panel-${id}`}
                tabIndex={isActive ? 0 : -1}
                title={hint}
                onClick={() => activate(id)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                className={cn("article-study-tab", focusRing)}
              >
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </button>
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
              <ArticleVocabulary articleId={articleId} active={activeTab === "words"} />
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
              <ArticleQuiz articleId={articleId} active={activeTab === "quiz"} />
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
              <ArticleDictation
                articleId={articleId}
                plainText={plainText}
                active={activeTab === "dictate"}
              />
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
              <ArticlePronunciation
                articleId={articleId}
                plainText={plainText}
                active={activeTab === "speak"}
              />
            )}
          </div>

          <div
            id="study-panel-notes"
            role="tabpanel"
            aria-labelledby="study-tab-notes"
            className="article-study-panel"
            hidden={activeTab !== "notes"}
          >
            <ReaderNotesPanel />
          </div>

          <div
            id="study-panel-ask"
            role="tabpanel"
            aria-labelledby="study-tab-ask"
            className="article-study-panel"
            hidden={activeTab !== "ask"}
          >
            {visited.has("ask") && (
              <ReaderTutorProvider articleId={articleId}>
                <ArticleTutor active={activeTab === "ask"} />
              </ReaderTutorProvider>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
