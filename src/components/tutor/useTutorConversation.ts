"use client";

/**
 * useTutorConversation
 *
 * Conversation state hook for the AI tutor panel.
 *
 * Owns: GET/POST/DELETE fetch state, transient message lifecycle,
 * fallback handling, and abort-on-unmount (REF-014 documented exception for
 * AbortController usage in ReaderTutorProvider).
 *
 * Privacy rule: only the current paragraph context may be sent with a
 * question; no reading history or private user data is included.
 */

import { useCallback, useEffect, useState } from "react";
import { deleteJson, getJson, postJson } from "@/lib/client-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TutorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO string from JSON
}

/** Transient UI state — not persisted, cleared after each ask cycle. */
export type TransientItem =
  | { kind: "user"; id: string; content: string; createdAt: string }
  | { kind: "thinking"; id: string }
  | { kind: "fallback"; id: string; content: string; createdAt: string }
  | { kind: "error"; id: string; content: string; question: string };

export interface TutorConversationState {
  messages: TutorMessage[];
  transient: TransientItem[];
  fetching: boolean;
  /** true after the initial GET has resolved (success or error). */
  loaded: boolean;
  asking: boolean;
  clearLoading: boolean;
  /** Set when clear() fails so the UI can surface a transient error. */
  clearError: string | null;
  ask: (question: string) => Promise<void>;
  /** Returns true on success, false if the delete failed. */
  clear: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTutorConversation(
  articleId: string,
  paragraphContext?: string,
): TutorConversationState {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [transient, setTransient] = useState<TransientItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Fetch conversation on mount (lazy: only mounted on first "ask" tab visit).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setFetching(true);
    void (async () => {
      try {
        const data = await getJson<{ messages: TutorMessage[] }>(
          `/api/reader/${articleId}/tutor`,
          { signal: controller.signal },
        );
        if (!cancelled) setMessages(data.messages ?? []);
      } catch {
        /* silently degrade — empty conversation shown */
      } finally {
        if (!cancelled) {
          setFetching(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [articleId]);

  // ---- ask ----
  const ask = useCallback(
    async (question: string): Promise<void> => {
      const q = question.trim();
      if (!q || asking) return;

      setAsking(true);
      const now = new Date().toISOString();
      const userItem: TransientItem = {
        kind: "user",
        id: `t-user-${Date.now()}`,
        content: q,
        createdAt: now,
      };

      setTransient([userItem, { kind: "thinking", id: "t-thinking" }]);

      try {
        const data = await postJson<{
          answer: string;
          fallback: boolean;
          messages: TutorMessage[];
        }>(`/api/reader/${articleId}/tutor`, {
          question: q,
          // #377 — Privacy: only the current paragraph of the article the
          // user is reading is sent as optional context. Capped at 500 chars
          // on the server. No other user data is included.
          ...(paragraphContext ? { paragraphContext } : {}),
        });

        // Replace persisted messages with server's authoritative list.
        setMessages(data.messages ?? []);

        if (data.fallback) {
          // fallback: true → answer not persisted. Keep the user's question as
          // a transient item + add the soft-unavailable note.
          setTransient([
            userItem,
            {
              kind: "fallback",
              id: `t-fallback-${Date.now()}`,
              content: data.answer,
              createdAt: new Date().toISOString(),
            },
          ]);
        } else {
          // Success: messages list now includes the new q+a. Clear transient.
          setTransient([]);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong.";
        setTransient([
          userItem,
          {
            kind: "error",
            id: `t-error-${Date.now()}`,
            content: msg,
            question: q,
          },
        ]);
      } finally {
        setAsking(false);
      }
    },
    [articleId, asking, paragraphContext],
  );

  // ---- clear ----
  const clear = useCallback(async (): Promise<boolean> => {
    setClearLoading(true);
    setClearError(null);
    try {
      await deleteJson(`/api/reader/${articleId}/tutor`);
      setMessages([]);
      setTransient([]);
      return true;
    } catch {
      setClearError("Couldn't clear the conversation — please try again.");
      return false;
    } finally {
      setClearLoading(false);
    }
  }, [articleId]);

  return {
    messages,
    transient,
    fetching,
    loaded,
    asking,
    clearLoading,
    clearError,
    ask,
    clear,
  };
}
