"use client";

/**
 * ReaderTutorProvider (M12)
 *
 * Context provider for the AI tutor chat panel. Mirrors the pattern used by
 * ReaderHighlightsProvider (M11): wraps its children in a context, fetches data
 * on mount, and exposes typed actions.
 *
 * Placement: inside the "ask" tabpanel in ReaderToolsPanel, under the
 * `visited.has("ask")` guard — so the GET fires lazily on first tab open only.
 *
 * Exported:
 *  - ReaderTutorProvider — the context provider (wraps ArticleTutor)
 *  - useTutor()          — the consumer hook
 *  - TutorMessage        — the persisted message type
 *  - TransientItem       — union of transient UI states
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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

interface TutorContextValue {
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
// Context
// ---------------------------------------------------------------------------

const TutorContext = createContext<TutorContextValue | null>(null);

export function useTutor(): TutorContextValue {
  const ctx = useContext(TutorContext);
  if (!ctx) {
    throw new Error("useTutor must be used within ReaderTutorProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface Props {
  articleId: string;
  children: ReactNode;
  /**
   * #377 — current reading paragraph context.
   *
   * Privacy / prompt-safety rule: ONLY the user's current paragraph of the
   * article they are actively reading is passed as context. No other user data
   * (personal information, reading history, etc.) is included. This narrows
   * the AI's grounding to the section the user is looking at, improving
   * relevance while staying strictly within the article they opened.
   */
  paragraphContext?: string;
}

export function ReaderTutorProvider({ articleId, children, paragraphContext }: Props) {
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
    fetch(`/api/reader/${articleId}/tutor`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { messages: TutorMessage[] }) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {
        /* silently degrade — empty conversation shown */
      })
      .finally(() => {
        if (!cancelled) {
          setFetching(false);
          setLoaded(true);
        }
      });
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
        const res = await fetch(`/api/reader/${articleId}/tutor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            // #377 — Privacy: only the current paragraph of the article the
            // user is reading is sent as optional context. Capped at 500 chars
            // on the server. No other user data is included.
            ...(paragraphContext ? { paragraphContext } : {}),
          }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          answer: string;
          fallback: boolean;
          messages: TutorMessage[];
        };

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
      const res = await fetch(`/api/reader/${articleId}/tutor`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
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

  return (
    <TutorContext.Provider
      value={{
        messages,
        transient,
        fetching,
        loaded,
        asking,
        clearLoading,
        clearError,
        ask,
        clear,
      }}
    >
      {children}
    </TutorContext.Provider>
  );
}
