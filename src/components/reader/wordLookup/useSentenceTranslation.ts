"use client";

import { useCallback, useRef, useState } from "react";
import { getTranslateLang, setTranslateLang } from "@/lib/translate-lang";
import type { TranslateSentenceResult } from "@/components/SentenceTranslatePopover";

export function useSentenceTranslation(articleId: string) {
  const [translateLang, setTranslateLangState] = useState<string>("zh-Hans");
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateResult, setTranslateResult] = useState<TranslateSentenceResult | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateText, setTranslateText] = useState<string>("");
  const [translateSelectionRect, setTranslateSelectionRect] = useState<DOMRect | null>(null);
  const requestRef = useRef(0);

  const seedTranslateLang = useCallback(() => {
    setTranslateLangState(getTranslateLang());
  }, []);

  const resetTranslation = useCallback(() => {
    setTranslateLoading(false);
    setTranslateResult(null);
    setTranslateError(null);
    setTranslateSelectionRect(null);
    setTranslateText("");
  }, []);

  const runSentenceTranslate = useCallback(async (text: string, lang: string) => {
    const reqId = ++requestRef.current;
    setTranslateLoading(true);
    setTranslateResult(null);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/translate-sentence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (requestRef.current !== reqId) return;
      if (!res.ok) throw new Error("Translation failed");
      const data = (await res.json()) as TranslateSentenceResult;
      if (requestRef.current !== reqId) return;
      setTranslateResult(data);
    } catch {
      if (requestRef.current !== reqId) return;
      setTranslateError("Couldn't translate that. Try again.");
    } finally {
      if (requestRef.current === reqId) setTranslateLoading(false);
    }
  }, [articleId]);

  const changeTranslateLang = useCallback((lang: string) => {
    setTranslateLangState(lang);
    setTranslateLang(lang);
    if (translateText) {
      void runSentenceTranslate(translateText, lang);
    }
  }, [runSentenceTranslate, translateText]);

  const retryTranslation = useCallback(() => {
    if (translateText) {
      void runSentenceTranslate(translateText, translateLang);
    }
  }, [runSentenceTranslate, translateLang, translateText]);

  return {
    translateLang,
    translateLoading,
    translateResult,
    translateError,
    translateText,
    translateSelectionRect,
    setTranslateText,
    setTranslateSelectionRect,
    seedTranslateLang,
    resetTranslation,
    runSentenceTranslate,
    changeTranslateLang,
    retryTranslation,
  };
}
