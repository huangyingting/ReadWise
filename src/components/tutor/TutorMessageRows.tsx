"use client";

/**
 * Tutor chat message row components.
 *
 * TutorMsgRow      — persisted message bubble (user or assistant)
 * TutorThinking    — typing indicator while asking
 * TutorUnavailable — soft error/fallback note with optional retry
 */

import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatRelative } from "@/lib/format-relative";
import { TutorMarkdownRenderer } from "@/components/tutor/TutorMarkdownRenderer";
import type { TutorMessage } from "@/components/tutor/useTutorConversation";

/** Persisted message bubble — user (indigo, right-aligned) or assistant (un-tinted). */
export function TutorMsgRow({ msg }: { msg: TutorMessage }) {
  if (msg.role === "user") {
    return (
      <div className="rw-tutor-msg rw-tutor-msg--user rw-fade-up">
        <div className="rw-tutor-bubble-user">{msg.content}</div>
        {msg.createdAt ? (
          <span className="rw-tutor-msg-time" title={msg.createdAt}>
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
      <TutorMarkdownRenderer content={msg.content} />
      {msg.createdAt ? (
        <span className="rw-tutor-msg-time" title={msg.createdAt}>
          {formatRelative(msg.createdAt)}
        </span>
      ) : null}
    </div>
  );
}

/** Typing indicator — shown while the POST is in flight. */
export function TutorThinking() {
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

/** Soft unavailable note — AI fallback or network error, with optional retry. */
export function TutorUnavailable({
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
