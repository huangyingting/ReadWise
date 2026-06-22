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
 * XSS safety: assistant answers are rendered via renderBlocks() which uses
 * tokenizeBlocks() from @/lib/tutor-markdown. Every leaf is a React {string}
 * child — no dangerouslySetInnerHTML, no HTML path.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Send, Sparkles } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Spinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/EmptyState";
import ConfirmAction from "@/components/ConfirmAction";
import AiBadge from "@/components/AiBadge";
import {
  useTutor,
  type TutorMessage,
  type TransientItem,
} from "@/components/ReaderTutorProvider";
import {
  tokenizeBlocks,
  type Block,
  type InlineToken,
} from "@/lib/tutor-markdown";

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
// Markdown rendering helpers — TEXT only, no HTML path
// ---------------------------------------------------------------------------

function renderInlineTokens(tokens: InlineToken[], prefix: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${prefix}-${i}`;
    if (tok.type === "bold") return <strong key={key}>{tok.value}</strong>;
    if (tok.type === "code") return <code key={key}>{tok.value}</code>;
    // type === "text": plain string — React escapes it automatically (XSS-safe)
    return tok.value;
  });
}

function renderBlocks(blocks: Block[]): ReactNode {
  return (
    <div className="rw-tutor-answer">
      {blocks.map((block, bi) => {
        if (block.type === "ul") {
          return (
            <ul key={bi}>
              {block.items.map((tokens, li) => (
                <li key={li}>{renderInlineTokens(tokens, `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={bi}>
              {block.items.map((tokens, li) => (
                <li key={li}>{renderInlineTokens(tokens, `${bi}-${li}`)}</li>
              ))}
            </ol>
          );
        }
        // paragraph
        const children: ReactNode[] = [];
        block.lines.forEach((lineTokens, li) => {
          if (li > 0) children.push(<br key={`br-${li}`} />);
          children.push(...renderInlineTokens(lineTokens, `${bi}-p${li}`));
        });
        return <p key={bi}>{children}</p>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function formatRelative(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Persisted message bubble — user (indigo) or assistant (un-tinted content). */
function TutorMsgRow({ msg }: { msg: TutorMessage }) {
  if (msg.role === "user") {
    return (
      <div className="rw-tutor-msg rw-tutor-msg--user rw-fade-up">
        <div className="rw-tutor-bubble-user">{msg.content}</div>
        {msg.createdAt ? (
          <span
            className="rw-tutor-msg-time"
            title={msg.createdAt}
          >
            {formatRelative(msg.createdAt)}
          </span>
        ) : null}
      </div>
    );
  }

  // assistant
  return (
    <div
      className="rw-tutor-msg rw-tutor-msg--assistant rw-fade-up"
      tabIndex={-1}
      data-role="assistant"
    >
      <div className="rw-tutor-msg-header">
        <span className="rw-tutor-avatar" aria-hidden="true">
          <Sparkles size={14} />
        </span>
      </div>
      {renderBlocks(tokenizeBlocks(msg.content))}
      {msg.createdAt ? (
        <span
          className="rw-tutor-msg-time"
          title={msg.createdAt}
        >
          {formatRelative(msg.createdAt)}
        </span>
      ) : null}
    </div>
  );
}

/** Typing indicator — shown while the POST is in flight. */
function TutorThinking() {
  return (
    <div
      className="rw-tutor-msg rw-tutor-msg--assistant rw-tutor-typing"
      role="status"
      aria-label="Tutor is thinking"
    >
      <span className="rw-tutor-avatar" aria-hidden="true">
        <Sparkles size={14} />
      </span>
      <div className="rw-tutor-dots" aria-hidden="true">
        <span className="rw-tutor-dot" style={{ animationDelay: "0ms" }} />
        <span className="rw-tutor-dot" style={{ animationDelay: "160ms" }} />
        <span className="rw-tutor-dot" style={{ animationDelay: "320ms" }} />
      </div>
      <span className="rw-tutor-thinking-label">Thinking…</span>
    </div>
  );
}

/** Soft unavailable note — AI fallback or network error. */
function TutorUnavailable({
  content,
  isError = false,
  onRetry,
}: {
  content: string;
  isError?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rw-tutor-msg rw-tutor-msg--assistant rw-fade-up"
      role={isError ? "alert" : "status"}
    >
      <div className="rw-tutor-unavailable">
        <AlertTriangle size={14} className="rw-tutor-unavailable-icon" aria-hidden="true" />
        <div className="rw-tutor-unavailable-body">
          <span>{content}</span>
          {isError && onRetry ? (
            <Button
              variant="outline"
              size="sm"
              className="rw-tutor-retry"
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll helpers
// ---------------------------------------------------------------------------

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

function scrollToBottomInstant(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

function scrollToBottomSmooth(el: HTMLElement): void {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ArticleTutor({ active }: { active: boolean }) {
  const { messages, transient, fetching, loaded, asking, clearLoading, ask, clear } =
    useTutor();

  const [question, setQuestion] = useState("");
  const [jumpVisible, setJumpVisible] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const prevAskingRef = useRef(false);

  const hasConversation =
    messages.length > 0 || transient.length > 0;

  // ---- Focus composer on tab activation ----
  // The textarea is disabled while fetching, so we must wait for loaded before
  // attempting focus. Dep on `loaded` handles the first-open case; dep on
  // `active` handles re-opens when data is already cached (loaded stays true).
  useEffect(() => {
    if (active && loaded) {
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [active, loaded]);

  // ---- Scroll management: fires after DOM commits ----
  useLayoutEffect(() => {
    const wasAsking = prevAskingRef.current;
    prevAskingRef.current = asking;

    const list = listRef.current;
    if (!list) return;

    if (!wasAsking && asking) {
      // Just started asking → scroll to bottom instantly so user sees question
      scrollToBottomInstant(list);
      setJumpVisible(false);
    } else if (wasAsking && !asking) {
      // Answer arrived → smart scroll
      if (isAtBottom(list)) {
        scrollToBottomSmooth(list);
        setJumpVisible(false);
      } else {
        setJumpVisible(true);
      }
    }
  }, [asking]);

  // ---- Input handlers ----
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setQuestion(e.target.value);
      // Auto-grow: reset to auto then set to scrollHeight (clamped to max-height via CSS)
      const ta = e.target;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    },
    [],
  );

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
    // Reset textarea height
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    // Keep focus in composer for follow-up
    composerRef.current?.focus();
    await ask(q);
  }, [question, asking, fetching, ask]);

  const handleClear = useCallback(async () => {
    await clear();
    setJumpVisible(false);
    // Announce and focus composer
    setAnnouncement("");
    setTimeout(() => setAnnouncement("Conversation cleared"), 50);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [clear]);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    scrollToBottomSmooth(list);
    setJumpVisible(false);
  }, []);

  // ---- Mobile: scroll composer into view when keyboard opens ----
  const handleComposerFocus = useCallback(() => {
    setTimeout(() => {
      composerRef.current?.scrollIntoView({ block: "nearest" });
    }, 300);
  }, []);

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
                <button
                  key={q}
                  type="button"
                  className={cn("rw-tutor-chip", focusRing)}
                  onClick={() => void ask(q)}
                  disabled={asking}
                >
                  {q}
                </button>
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
            <button
              type="button"
              className={cn("rw-tutor-jump-btn", focusRing)}
              onClick={scrollToBottom}
            >
              ↓ New answer
            </button>
          </div>
        ) : null}
      </div>

      {/* ---- Sticky composer ---- */}
      <div className="rw-tutor-composer">
        <Textarea
          ref={composerRef}
          className={cn("rw-tutor-input", focusRing)}
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
