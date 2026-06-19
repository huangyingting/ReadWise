"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DictionaryResult } from "@/lib/dictionary";

type Anchor = { x: number; y: number };

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 380; // approximate max height
/** Height of the fixed mini-player (matches .reader-mini-player height: 56px). */
const MINI_PLAYER_HEIGHT = 56;

/** Resolves the word under a viewport point using the caret APIs. */
function wordAtPoint(x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const text = node.textContent ?? "";
  const isWordChar = (c: string) => /[A-Za-z'''-]/.test(c);

  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }

  const word = text.slice(start, end).trim();
  return word || null;
}

export default function WordLookup({ html }: { html: string }) {
  const proseRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [word, setWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    setWord("");
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  const runLookup = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: term }),
      });
      if (!res.ok) {
        throw new Error("Lookup failed");
      }
      const data = (await res.json()) as DictionaryResult;
      setResult(data);
    } catch {
      setError("Could not look up this word. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelect = useCallback(
    (clientX: number, clientY: number) => {
      const selection = window.getSelection();
      const selected = selection?.toString().trim() ?? "";
      let candidate = "";

      if (selected) {
        candidate = selected.split(/\s+/)[0] ?? "";
      } else {
        candidate = wordAtPoint(clientX, clientY) ?? "";
      }

      candidate = candidate.replace(/^[^A-Za-z'']+|[^A-Za-z'']+$/g, "");

      if (!candidate || !/[A-Za-z]/.test(candidate)) {
        return;
      }

      // Clamp left so popover stays within the viewport.
      const left = Math.min(clientX, window.innerWidth - POPOVER_WIDTH - 12);
      const clampedLeft = Math.max(12, left);

      // Clamp top so popover never hides behind the audio mini-player.
      // If the click is in the lower zone, flip the popover above the caret.
      const safeBottom = window.innerHeight - MINI_PLAYER_HEIGHT - POPOVER_HEIGHT - 12;
      let top: number;
      if (clientY > safeBottom) {
        // Flip above the caret
        top = clientY - POPOVER_HEIGHT - 12;
      } else {
        top = clientY + 12;
      }
      top = Math.max(12, top);

      setAnchor({ x: clampedLeft, y: top });
      setWord(candidate);
      void runLookup(candidate);
    },
    [runLookup],
  );

  // Close on outside click or Escape.
  useEffect(() => {
    if (!anchor) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        proseRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, close]);

  function playAudio(src: string) {
    audioRef.current?.pause();
    const audio = new Audio(src);
    audioRef.current = audio;
    void audio.play().catch(() => {});
  }

  return (
    <>
      <div
        ref={proseRef}
        className="prose word-lookup-prose"
        onMouseUp={(e) => handleSelect(e.clientX, e.clientY)}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {anchor ? (
        <div
          ref={popoverRef}
          className="word-lookup-popover"
          role="dialog"
          aria-label={`Dictionary: ${word}`}
          style={{ left: anchor.x, top: anchor.y, zIndex: 60 }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="word-lookup-header">
            <strong className="word-lookup-word">{word}</strong>
            <button
              type="button"
              className="word-lookup-close"
              aria-label="Close"
              onClick={close}
            >
              ×
            </button>
          </div>

          {loading ? (
            <p className="muted word-lookup-status">Looking up…</p>
          ) : null}

          {error ? (
            <p className="word-lookup-error" role="alert">
              {error}
            </p>
          ) : null}

          {!loading && !error && result ? (
            result.found ? (
              <div className="word-lookup-body">
                {result.lookedUp &&
                result.lookedUp.toLowerCase() !== word.toLowerCase() ? (
                  <p className="muted word-lookup-base">
                    base form: <em>{result.lookedUp}</em>
                  </p>
                ) : null}

                {result.phonetic || result.audio ? (
                  <p className="word-lookup-pron">
                    {result.phonetic ? (
                      <span className="word-lookup-phonetic">
                        {result.phonetic}
                      </span>
                    ) : null}
                    {result.audio ? (
                      <button
                        type="button"
                        className="word-lookup-audio"
                        aria-label="Play pronunciation"
                        onClick={() => playAudio(result.audio as string)}
                      >
                        🔊
                      </button>
                    ) : null}
                  </p>
                ) : null}

                <ul className="word-lookup-meanings">
                  {result.meanings.map((meaning) => (
                    <li
                      key={meaning.partOfSpeech}
                      className="word-lookup-meaning"
                    >
                      <span className="word-lookup-pos">
                        {meaning.partOfSpeech}
                      </span>
                      <ol className="word-lookup-defs">
                        {meaning.definitions.map((def, i) => (
                          <li key={i}>
                            {def.definition}
                            {def.example ? (
                              <span className="word-lookup-example muted">
                                {" "}
                                &ldquo;{def.example}&rdquo;
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted word-lookup-status">
                No definition found for &ldquo;{word}&rdquo;.
              </p>
            )
          ) : null}
        </div>
      ) : null}
    </>
  );
}

