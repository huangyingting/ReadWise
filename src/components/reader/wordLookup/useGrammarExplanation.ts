"use client";

import { useCallback, useRef, useState } from "react";
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
  const requestRef = useRef(0);

  const resetGrammar = useCallback(() => {
    ++requestRef.current;
    setGrammarLoading(false);
    setGrammarResult(null);
    setGrammarError(null);
    setGrammarSelectionRect(null);
    setGrammarPhrase("");
  }, []);

  const runGrammarExplain = useCallback(async (phrase: string) => {
    const reqId = ++requestRef.current;
    setGrammarLoading(true);
    setGrammarResult(null);
    setGrammarError(null);
    try {
      const contextSentence = contextSentenceFor(phrase);
      const data = await requestGrammarExplanation(articleId, phrase, contextSentence);
      if (requestRef.current !== reqId) return;
      setGrammarResult(data);
    } catch {
      if (requestRef.current !== reqId) return;
      setGrammarError(GRAMMAR_ERROR_MESSAGE);
    } finally {
      if (requestRef.current === reqId) setGrammarLoading(false);
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
