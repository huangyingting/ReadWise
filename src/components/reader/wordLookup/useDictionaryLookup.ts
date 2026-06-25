"use client";

import { useCallback, useState } from "react";
import type { DictionaryResult } from "@/lib/dictionary";

export function useDictionaryLookup() {
  const [word, setWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);

  const resetDictionary = useCallback(() => {
    setResult(null);
    setDictError(null);
    setLoading(false);
  }, []);

  const runLookup = useCallback(async (term: string) => {
    setLoading(true);
    setDictError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: term }),
      });
      if (!res.ok) throw new Error("Lookup failed");
      setResult((await res.json()) as DictionaryResult);
    } catch {
      setDictError("Could not look up this word. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    word,
    setWord,
    loading,
    result,
    dictError,
    resetDictionary,
    runLookup,
  };
}
