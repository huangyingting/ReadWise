"use client";

import { useCallback, useState } from "react";
import type { GrammarResult } from "@/components/GrammarPopover";

type ContextSentenceProvider = (phrase: string) => string;

const GRAMMAR_ERROR_MESSAGE = "Couldn't fetch grammar explanation. Try again.";

async function requestGrammarExplanation(
  articleId: string,
  phrase: string,
  contextSentence: string,
) {
  const res = await fetch(`/api/reader/${articleId}/grammar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrase, contextSentence }),
  });

  if (!res.ok) throw new Error("Request failed");

  return (await res.json()) as GrammarResult;
}

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
      setGrammarResult(await requestGrammarExplanation(articleId, phrase, contextSentence));
    } catch {
      setGrammarError(GRAMMAR_ERROR_MESSAGE);
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
