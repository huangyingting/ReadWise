"use client";

import { useCallback, useRef, useState } from "react";
import type { DictionaryResult } from "@/lib/lexical/provider";

const DICTIONARY_ENDPOINT = "/api/dictionary";
const DICTIONARY_ERROR_MESSAGE = "Could not look up this word. Please try again.";

export function useDictionaryLookup() {
  const [word, setWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const resetDictionary = useCallback(() => {
    ++requestRef.current;
    setResult(null);
    setDictError(null);
    setLoading(false);
  }, []);

  const runLookup = useCallback(async (term: string) => {
    const reqId = ++requestRef.current;
    setLoading(true);
    setDictError(null);
    setResult(null);
    try {
      const res = await fetch(DICTIONARY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: term }),
      });
      if (!res.ok) throw new Error("Lookup failed");
      if (requestRef.current !== reqId) return;
      setResult((await res.json()) as DictionaryResult);
    } catch {
      if (requestRef.current !== reqId) return;
      setDictError(DICTIONARY_ERROR_MESSAGE);
    } finally {
      if (requestRef.current === reqId) setLoading(false);
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
