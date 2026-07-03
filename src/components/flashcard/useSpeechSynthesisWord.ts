"use client";

/**
 * useSpeechSynthesisWord — browser SpeechSynthesis hook.
 *
 * Tracks whether speech synthesis is available, which card is currently
 * being spoken, and provides a speak/toggle function.
 * Cancels any in-flight utterance on unmount.
 */
import { useState, useEffect, useCallback } from "react";

function hasSpeechSynthesis(): boolean {
  return "speechSynthesis" in window;
}

function cancelSpeech(): void {
  if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
}

export function useSpeechSynthesisWord() {
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);

  useEffect(() => {
    setSpeechAvailable(hasSpeechSynthesis());
    return cancelSpeech;
  }, []);

  /** Toggle pronunciation of `word` identified by `cardId`. */
  const speak = useCallback(
    (word: string, cardId: string) => {
      if (!hasSpeechSynthesis()) return;
      if (speaking === cardId) {
        cancelSpeech();
        setSpeaking(null);
        return;
      }
      cancelSpeech();
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
