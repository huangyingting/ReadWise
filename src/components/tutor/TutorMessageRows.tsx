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

const TYPING_DOT_DELAYS = ["0ms", "160ms", "320ms"] as const;

function TutorAvatar() {
  return (
    <span className="rw-tutor-avatar" aria-hidden="true">
      <Sparkles size={14} />
    </span>
  );
}

function MessageTime({ createdAt }: { createdAt?: string | null }) {
  if (!createdAt) return null;

  return (
    <span className="rw-tutor-msg-time" title={createdAt}>
      {formatRelative(createdAt)}
    </span>
  );
}

type TutorUnavailableProps = {
  content: string;
  isError?: boolean;
  onRetry?: () => void;
};

/** Persisted message bubble — user (indigo, right-aligned) or assistant (un-tinted). */
export function TutorMsgRow({ msg }: { msg: TutorMessage }) {
  if (msg.role === "user") {
    return (
      <div className="rw-tutor-msg rw-tutor-msg--user rw-fade-up">
        <div className="rw-tutor-bubble-user">{msg.content}</div>
        <MessageTime createdAt={msg.createdAt} />
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
        <TutorAvatar />
      </div>
      <TutorMarkdownRenderer content={msg.content} />
      <MessageTime createdAt={msg.createdAt} />
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
      <TutorAvatar />
      <div className="rw-tutor-dots" aria-hidden="true">
        {TYPING_DOT_DELAYS.map((delay) => (
          <span
            key={delay}
            className="rw-tutor-dot"
            style={{ animationDelay: delay }}
          />
        ))}
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
}: TutorUnavailableProps) {
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
