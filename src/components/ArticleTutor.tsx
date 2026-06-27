"use client";

/**
 * ArticleTutor (M12)
 *
 * The "Ask" tab panel. Renders the full tutor chat UI by consuming the
 * ReaderTutorProvider context. All panel infrastructure (stay-mounted, lazy
 * activation, tab/panel IDs) lives in ReaderToolsPanel.
 *
 * Layout:
 *   ┌─ grounding strip (fixed top) ─────────────────────────────┐
 *   │  ░ Answers based on this article · tuned to your level ░  │
 *   ├───────────────────────────────────────────────────────────┤
 *   │   scrollable message list (role="log" aria-live="polite") │
 *   │   • empty state + suggested starter chips when empty      │
 *   │   • user bubbles (indigo, right-aligned)                  │
 *   │   • assistant answers (un-tinted, markdown-light)         │
 *   │   • typing indicator while asking                         │
 *   │   • unavailable note on fallback                          │
 *   ├───────────────────────────────────────────────────────────┤
 *   │  ╭─ sticky composer ──────────────────────────────────╮  │
 *   │  │  [ growing textarea          ] [Send]               │  │
 *   │  ╰────────────────────────────────────────────────────╯  │
 *   └───────────────────────────────────────────────────────────┘
 *
 * XSS safety: assistant answers are rendered via TutorMarkdownRenderer which
 * uses tokenizeBlocks() from @/lib/tutor-markdown. Every leaf is a React
 * {string} child — no dangerouslySetInnerHTML, no HTML path.
 */

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { Send, Sparkles } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { Textarea } from "@/components/ui/Textarea";
import { Spinner } from "@/components/ui/Spinner";
import ConfirmAction from "@/components/ConfirmAction";
import AiBadge from "@/components/AiBadge";
import { useTutor } from "@/components/ReaderTutorProvider";
import { TutorMsgRow, TutorThinking, TutorUnavailable } from "@/components/tutor/TutorMessageRows";
import { useAutoScrollLog } from "@/components/tutor/useAutoScrollLog";
import { useAutoGrowingTextarea } from "@/components/tutor/useAutoGrowingTextarea";
import { formatRelative } from "@/lib/format-relative";

// ---------------------------------------------------------------------------
// Starter questions (coordinator-approved wording)
// ---------------------------------------------------------------------------

const STARTER_QUESTIONS = [
  "Summarize this article",
  "What are the key vocabulary words?",
  "Explain the main argument simply",
  "What should I take away from this?",
] as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ArticleTutor({ active }: { active: boolean }) {
  const { messages, transient, fetching, loaded, asking, clearLoading, clearError, ask, clear } =
    useTutor();

  const [question, setQuestion] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const { listRef, jumpVisible, setJumpVisible, scrollToBottom } = useAutoScrollLog({ asking });
  const { composerRef, handleInputChange, resetHeight } = useAutoGrowingTextarea(setQuestion);

  const hasConversation = messages.length > 0 || transient.length > 0;

  // ---- Focus composer on tab activation ----
  // The textarea is disabled while fetching, so we must wait for loaded before
  // attempting focus. Dep on `loaded` handles the first-open case; dep on
  // `active` handles re-opens when data is already cached (loaded stays true).
  useEffect(() => {
    if (active && loaded) {
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [active, loaded, composerRef]);

  // ---- Input handlers ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();
        void handleSend();
      }
    },
    // handleSend is defined below; captured via closure on each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question, asking, fetching],
  );

  const handleSend = useCallback(async () => {
    const q = question.trim();
    if (!q || asking || fetching) return;
    setQuestion("");
    resetHeight();
    // Keep focus in composer for follow-up
    composerRef.current?.focus();
    await ask(q);
  }, [question, asking, fetching, ask, resetHeight, composerRef]);

  const handleClear = useCallback(async () => {
    const ok = await clear();
    if (!ok) {
      // Surface the failure; the conversation is left intact.
      setAnnouncement("");
      setTimeout(() => setAnnouncement("Couldn't clear the conversation"), 50);
      return;
    }
    setJumpVisible(false);
    // Announce and focus composer
    setAnnouncement("");
    setTimeout(() => setAnnouncement("Conversation cleared"), 50);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [clear, setJumpVisible, composerRef]);

  // ---- Mobile: scroll composer into view when keyboard opens ----
  const handleComposerFocus = useCallback(() => {
    setTimeout(() => {
      composerRef.current?.scrollIntoView({ block: "nearest" });
    }, 300);
  }, [composerRef]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="rw-tutor">
      {/* ---- Grounding strip ---- */}
      <div className="rw-tutor-grounding">
        <div className="rw-tutor-grounding-left">
          <Sparkles size={12} aria-hidden="true" className="rw-tutor-grounding-icon" />
          <span className="rw-tutor-grounding-text">
            Answers are based on this article · tuned to your level.
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <AiBadge />
          {hasConversation ? (
            <ConfirmAction
              triggerLabel="Clear"
              triggerVariant="outline"
              size="sm"
              confirmMessage="Clear this conversation? Your questions and the tutor's answers for this article will be deleted."
              confirmLabel="Clear"
              confirmVariant="danger"
              onConfirm={handleClear}
              loading={clearLoading}
              className="!min-w-0"
            />
          ) : null}
        </div>
      </div>

      {clearError ? (
        <p role="alert" className="translation-error" style={{ marginTop: "var(--space-2)" }}>
          {clearError}
        </p>
      ) : null}

      {/* ---- Message list ---- */}
      <div
        ref={listRef}
        className="rw-tutor-list"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation with the tutor"
      >
        {/* Initial load */}
        {fetching ? (
          <div className="rw-tutor-loading" aria-live="polite">
            <Spinner size={16} />
            <span>Loading your conversation…</span>
          </div>
        ) : null}

        {/* Empty state: only shown once loaded with no messages */}
        {!fetching && loaded && messages.length === 0 && transient.length === 0 ? (
          <div className="rw-tutor-empty">
            <EmptyState
              icon={Sparkles}
              title="Ask the tutor"
              description="Have a question about this article? Ask in your own words. Answers come from this article and are tuned to your English level."
              className="!py-[var(--space-6)] border-none bg-transparent"
            />
            <div
              className="rw-tutor-suggestions"
              role="group"
              aria-label="Suggested questions"
            >
              {STARTER_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  variant="ghost"
                  size="sm"
                  className="rw-tutor-chip"
                  onClick={() => void ask(q)}
                  disabled={asking}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Persisted messages */}
        {messages.map((msg) => (
          <TutorMsgRow key={msg.id} msg={msg} />
        ))}

        {/* Transient items (optimistic + in-flight + fallback + error) */}
        {transient.map((item) => {
          if (item.kind === "user") {
            return (
              <div
                key={item.id}
                className="rw-tutor-msg rw-tutor-msg--user rw-fade-up"
              >
                <div className="rw-tutor-bubble-user">{item.content}</div>
                <span className="rw-tutor-msg-time" title={item.createdAt}>
                  {formatRelative(item.createdAt)}
                </span>
              </div>
            );
          }
          if (item.kind === "thinking") {
            return <TutorThinking key={item.id} />;
          }
          if (item.kind === "fallback") {
            return (
              <TutorUnavailable
                key={item.id}
                content={item.content}
                isError={false}
              />
            );
          }
          if (item.kind === "error") {
            return (
              <TutorUnavailable
                key={item.id}
                content="Something went wrong sending that. Tap to retry."
                isError={true}
                onRetry={() => void ask(item.question)}
              />
            );
          }
          return null;
        })}

        {/* "↓ New answer" jump pill — sticky bottom of list */}
        {jumpVisible ? (
          <div className="rw-tutor-jump">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rw-tutor-jump-btn"
              onClick={scrollToBottom}
            >
              ↓ New answer
            </Button>
          </div>
        ) : null}
      </div>

      {/* ---- Sticky composer ---- */}
      <div className="rw-tutor-composer">
        <Textarea
          ref={composerRef}
          className="rw-tutor-input"
          placeholder="Ask anything about this article…"
          value={question}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleComposerFocus}
          disabled={fetching}
          maxLength={1000}
          rows={1}
          aria-label="Your question"
        />
        <Button
          variant="primary"
          size="sm"
          className="rw-tutor-send"
          onClick={() => void handleSend()}
          disabled={!question.trim() || asking || fetching}
          loading={asking}
          aria-label="Send question"
          aria-disabled={!question.trim() || asking || fetching}
        >
          <Send size={14} aria-hidden="true" />
        </Button>
      </div>

      {/* ---- A11y announcement region ---- */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="rw-sr-live"
      >
        {announcement}
      </div>
    </div>
  );
}
