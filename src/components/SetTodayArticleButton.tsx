"use client";

/**
 * SetTodayArticleButton — learner affordance to set a readable article as their
 * Today primary (v1.1, #805).
 *
 * Calls `POST /api/today/set-article` with the article id ONLY (never content),
 * always scoped server-side to the authenticated user. Renders in two shapes:
 *
 *   - `variant="inline"` — a labelled {@link Button} for the Reader header and
 *     the import success surface, with an adjacent live-region status/error line.
 *   - `variant="overlay"` — a compact {@link IconButton} sibling overlay for
 *     {@link ArticleCardView} (top-left, mirroring the bookmark button top-right),
 *     with success/error surfaced via its accessible label + title.
 *
 * Only rendered by server components that have already checked
 * `isTodaySessionFeatureEnabled()`, so it is hidden whenever the flag is off.
 */

import { useState } from "react";
import { CalendarCheck, CalendarPlus, Check } from "lucide-react";
import { ApiResponseError, postJson } from "@/lib/client-fetch";
import { Button, IconButton, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

type Status = "idle" | "pending" | "success" | "error";

export interface SetTodayArticleButtonProps {
  articleId: string;
  articleTitle: string;
  variant?: "inline" | "overlay";
  /** Inline button visual size (ignored for the overlay variant). */
  size?: "sm" | "md";
  className?: string;
}

const SUCCESS_MESSAGE = "Set as today's article.";
const DEFAULT_ERROR = "Couldn't set today's article. Please try again.";

function getOverlayLabel(status: Status, articleTitle: string): string {
  return status === "success"
    ? `"${articleTitle}" is today's article`
    : `Set "${articleTitle}" as today's article`;
}

function getInlineLabel(status: Status): string {
  return status === "success" ? "Today's article" : "Set as today's article";
}

function getErrorMessage(err: unknown): string {
  return err instanceof ApiResponseError && err.message ? err.message : DEFAULT_ERROR;
}

export default function SetTodayArticleButton({
  articleId,
  articleTitle,
  variant = "inline",
  size = "sm",
  className,
}: SetTodayArticleButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (status === "pending") return;
    setStatus("pending");
    setMessage(null);
    try {
      await postJson("/api/today/set-article", { articleId });
      setStatus("success");
      setMessage(SUCCESS_MESSAGE);
    } catch (err) {
      setStatus("error");
      setMessage(getErrorMessage(err));
    }
  }

  const isPending = status === "pending";
  const isSuccess = status === "success";
  const isError = status === "error";

  if (variant === "overlay") {
    const label = getOverlayLabel(status, articleTitle);
    return (
      <Tooltip
        content={isError ? (message ?? DEFAULT_ERROR) : label}
        className="absolute top-[var(--space-3)] left-[var(--space-3)] z-10"
      >
        <IconButton
          type="button"
          size="md"
          aria-label={label}
          disabled={isPending || isSuccess}
          onClick={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={cn(
            "border shadow-[var(--shadow-sm)]",
            "bg-surface/80 backdrop-blur-sm text-text-subtle border-border",
            "transition-[opacity,background-color,border-color,color]",
            "[transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
            "motion-reduce:transition-none",
            // Hidden until card hover / focus, like the bookmark overlay.
            "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
            isSuccess &&
              "opacity-100 text-primary-text border-[color-mix(in_srgb,var(--primary)_38%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]",
            isError && "opacity-100 text-[var(--danger-text)] border-[var(--danger)]",
            className,
          )}
        >
          {isSuccess ? (
            <Check size={16} aria-hidden />
          ) : (
            <CalendarPlus size={16} aria-hidden />
          )}
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <div className={cn("flex flex-col gap-[var(--space-1)]", className)}>
      <div>
        <Button
          type="button"
          variant="secondary"
          size={size}
          loading={isPending}
          disabled={isSuccess}
          leadingIcon={
            isSuccess ? (
              <Check size={16} aria-hidden />
            ) : (
              <CalendarCheck size={16} aria-hidden />
            )
          }
          onClick={() => void submit()}
        >
          {getInlineLabel(status)}
        </Button>
      </div>
      {message ? (
        <span
          role={isError ? "alert" : "status"}
          className={cn(
            "text-[length:var(--text-xs)]",
            isError ? "text-[var(--danger-text)]" : "text-text-muted",
          )}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
