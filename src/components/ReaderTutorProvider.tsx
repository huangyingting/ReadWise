"use client";

/**
 * ReaderTutorProvider (M12)
 *
 * Context provider for the AI tutor chat panel. Thin wrapper around
 * `useTutorConversation` that puts conversation state into React context.
 *
 * Placement: inside the "ask" tabpanel in ReaderToolsPanel, under the
 * `visited.has("ask")` guard — so the GET fires lazily on first tab open only.
 *
 * Exported:
 *  - ReaderTutorProvider — the context provider (wraps ArticleTutor)
 *  - useTutor()          — the consumer hook
 */

import { createContext, useContext, type ReactNode } from "react";
import {
  useTutorConversation,
  type TutorConversationState,
} from "@/components/tutor/useTutorConversation";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TutorContext = createContext<TutorConversationState | null>(null);

export function useTutor(): TutorConversationState {
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
  const state = useTutorConversation(articleId, paragraphContext);

  return (
    <TutorContext.Provider value={state}>
      {children}
    </TutorContext.Provider>
  );
}
