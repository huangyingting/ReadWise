"use client";

import { useCallback, useState } from "react";
import type { GrammarResult } from "@/components/GrammarPopover";

type ContextSentenceProvider = (phrase: string) => string;

export function useGrammarExplanation(
  articleId: string,
  contextSentenceFor: ContextSentenceProvider,
) {
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [grammarResult, setGrammarResult] = useState<GrammarResult | null>(null);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const [grammarPhrase, setGrammarPhrase] = useState<string>("");
  const [grammarSelectionRect, setGrammarSelectionRect] = useState<DOMRect | null>(null);

  const resetGrammar = useCallback(() => {
    setGrammarLoading(false);
    setGrammarResult(null);
    setGrammarError(null);
    setGrammarSelectionRect(null);
    setGrammarPhrase("");
  }, []);

  const runGrammarExplain = useCallback(async (phrase: string) => {
    setGrammarLoading(true);
    setGrammarResult(null);
    setGrammarError(null);
    try {
      const contextSentence = contextSentenceFor(phrase);
      const res = await fetch(`/api/reader/${articleId}/grammar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase, contextSentence }),
      });
      if (!res.ok) throw new Error("Request failed");
      setGrammarResult((await res.json()) as GrammarResult);
    } catch {
      setGrammarError("Couldn't fetch grammar explanation. Try again.");
    } finally {
      setGrammarLoading(false);
    }
  }, [articleId, contextSentenceFor]);

  const retryGrammar = useCallback(() => {
    if (grammarPhrase) void runGrammarExplain(grammarPhrase);
  }, [grammarPhrase, runGrammarExplain]);

  return {
    grammarLoading,
    grammarResult,
    grammarError,
    grammarPhrase,
    grammarSelectionRect,
    setGrammarPhrase,
    setGrammarSelectionRect,
    resetGrammar,
    runGrammarExplain,
    retryGrammar,
  };
}
