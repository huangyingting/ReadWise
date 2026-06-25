"use client";

/**
 * useSpeechSynthesisWord — browser SpeechSynthesis hook.
 *
 * Tracks whether speech synthesis is available, which card is currently
 * being spoken, and provides a speak/toggle function.
 * Cancels any in-flight utterance on unmount.
 */
import { useState, useEffect, useCallback } from "react";

export function useSpeechSynthesisWord() {
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);

  useEffect(() => {
    setSpeechAvailable("speechSynthesis" in window);
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  /** Toggle pronunciation of `word` identified by `cardId`. */
  const speak = useCallback(
    (word: string, cardId: string) => {
      if (!("speechSynthesis" in window)) return;
      if (speaking === cardId) {
        window.speechSynthesis.cancel();
        setSpeaking(null);
        return;
      }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(word);
      utt.onend = () => setSpeaking(null);
      utt.onerror = () => setSpeaking(null);
      setSpeaking(cardId);
      window.speechSynthesis.speak(utt);
    },
    [speaking],
  );

  return { speechAvailable, speaking, speak };
}
