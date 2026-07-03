"use client";

/**
 * useCurrentReadingBlock (#376)
 *
 * IntersectionObserver-based hook that identifies the most-visible prose
 * block within a container element. OBSERVE-ONLY — never mutates or wraps
 * DOM content, so WordLookup anchors, highlights, bilingual view, and TTS
 * word-timing offsets remain intact.
 *
 * Exports:
 *  - MIN_BLOCK_TEXT_LENGTH — minimum text length (chars) for eligibility
 *  - BlockCandidate        — plain-data type used by the pure algorithm
 *  - ReadingBlock          — the hook's return type
 *  - pickMostVisibleBlock  — PURE selection algorithm (testable without DOM)
 *  - useCurrentReadingBlock — the hook itself
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum trimmed text length (chars) for a block to be eligible. */
export const MIN_BLOCK_TEXT_LENGTH = 20;

/** Debounce delay (ms) before committing a new active block. */
const DEBOUNCE_MS = 300;

/** Block-level element tag names to observe (uppercased, as tagName returns). */
const BLOCK_TAGS = new Set(["P", "H2", "H3", "H4", "LI", "BLOCKQUOTE"]);

const BLOCK_SELECTOR = "p, h2, h3, h4, li, blockquote";
const THRESHOLD_STEPS = 21;
const THRESHOLD_INCREMENT = 0.05;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Abstract input record used by the pure selection algorithm. */
export interface BlockCandidate {
  /** 0-based position among observed block elements in DOM order. */
  index: number;
  /** Current IntersectionObserver intersectionRatio (0–1). */
  ratio: number;
  /** Trimmed text content of the element. */
  text: string;
}

/** The currently active reading block returned by the hook. */
export interface ReadingBlock {
  /** 0-based index among observed block elements. */
  index: number;
  /** Trimmed text content of the block. */
  text: string;
  /** The DOM Element (for scroll/position queries if needed). */
  element: Element;
  /** IntersectionObserver intersectionRatio at the last callback. */
  ratio: number;
}

type BlockVisibility = {
  ratio: number;
  text: string;
};

// ---------------------------------------------------------------------------
// Pure selection algorithm (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Selects the most visible eligible block from a set of candidates.
 *
 * Rules:
 *  1. Skip blocks whose trimmed text length is below `minLength`.
 *  2. Skip blocks with ratio ≤ 0 (fully off-screen).
 *  3. Among eligible blocks, return the one with the highest ratio.
 *     (When ratios tie, the first one in document order wins, since
 *     candidates are assumed to be sorted by DOM position.)
 *  4. Returns null when no eligible block is visible.
 *
 * @pure — no DOM access, no side effects; safe to unit-test with synthetic input.
 */
export function pickMostVisibleBlock(
  candidates: BlockCandidate[],
  minLength: number = MIN_BLOCK_TEXT_LENGTH,
): BlockCandidate | null {
  let best: BlockCandidate | null = null;
  for (const c of candidates) {
    if (c.text.trim().length < minLength) continue;
    if (c.ratio <= 0) continue;
    if (!best || c.ratio > best.ratio) {
      best = c;
    }
  }
  return best;
}

function isObservedBlockElement(element: Element): boolean {
  return BLOCK_TAGS.has(element.tagName);
}

function getBlockText(element: Element): string {
  return (element.textContent ?? "").trim();
}

function getObservedBlocks(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll<Element>(BLOCK_SELECTOR)).filter(
    isObservedBlockElement,
  );
}

function createInitialVisibilityMap(elements: Element[]): Map<Element, BlockVisibility> {
  const visibilityMap = new Map<Element, BlockVisibility>();
  for (const element of elements) {
    visibilityMap.set(element, { ratio: 0, text: getBlockText(element) });
  }
  return visibilityMap;
}

function createCandidates(
  elements: Element[],
  visibilityMap: Map<Element, BlockVisibility>,
): BlockCandidate[] {
  return elements.map((element, index) => {
    const entry = visibilityMap.get(element);
    return { index, ratio: entry?.ratio ?? 0, text: entry?.text ?? "" };
  });
}

function createThresholds(): number[] {
  return Array.from(
    { length: THRESHOLD_STEPS },
    (_, index) => index * THRESHOLD_INCREMENT,
  );
}

function isSameReadingBlock(
  previous: ReadingBlock | null,
  next: BlockCandidate,
  element: Element,
): boolean {
  return (
    previous !== null &&
    previous.index === next.index &&
    previous.ratio === next.ratio &&
    previous.element === element
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Observes prose block elements inside `container` and returns the most-visible
 * one as a {@link ReadingBlock}.
 *
 * - Returns null on SSR, when IntersectionObserver is unavailable, or when no
 *   container is supplied — never throws.
 * - The returned block reference is stable across renders when the selected
 *   element has not changed.
 * - Does NOT mutate the prose DOM; safe alongside WordLookup / highlights /
 *   bilingual view / TTS highlighting.
 *
 * @param container - The prose element to observe (e.g. `.word-lookup-prose`).
 */
export function useCurrentReadingBlock(
  container: HTMLElement | null,
): ReadingBlock | null {
  const [block, setBlock] = useState<ReadingBlock | null>(null);

  // Per-element ratio + text cache, updated on every IO callback.
  const ratioMapRef = useRef<Map<Element, BlockVisibility>>(new Map());
  // Stable snapshot of observed elements in DOM order.
  const blocksRef = useRef<Element[]>([]);
  // Debounce timer handle.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Graceful fallback for SSR / environments without IntersectionObserver.
    if (!container || typeof IntersectionObserver === "undefined") return;

    // Snapshot block elements at mount time (static article — no dynamic content).
    const elements = getObservedBlocks(container);
    blocksRef.current = elements;

    // Initialise ratio map — all elements start at ratio 0.
    ratioMapRef.current = createInitialVisibilityMap(elements);

    function scheduleUpdate() {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const blks = blocksRef.current;
        const candidates = createCandidates(blks, ratioMapRef.current);

        const best = pickMostVisibleBlock(candidates);
        if (!best) {
          setBlock(null);
          return;
        }
        const el = blks[best.index];
        setBlock((prev) => {
          // Avoid spurious re-renders when nothing changed.
          if (isSameReadingBlock(prev, best, el)) {
            return prev;
          }
          return { index: best.index, text: best.text, element: el, ratio: best.ratio };
        });
      }, DEBOUNCE_MS);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const existing = ratioMapRef.current.get(entry.target);
          if (existing) {
            ratioMapRef.current.set(entry.target, {
              ...existing,
              ratio: entry.intersectionRatio,
            });
          }
        }
        scheduleUpdate();
      },
      // Sample 21 thresholds (every 5%) for smooth tracking.
      { threshold: createThresholds() },
    );

    for (const el of elements) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      setBlock(null);
    };
  }, [container]);

  return block;
}
