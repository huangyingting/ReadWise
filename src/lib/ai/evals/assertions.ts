/**
 * Shared assertion helpers for feature evaluators.
 */

import type { EvalPropertyResult } from "@/lib/ai/evals/types";

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function pass(name: string, condition: boolean, detail?: string): EvalPropertyResult {
  return { name, passed: condition, detail: condition ? undefined : detail };
}

/** Counts blank-line-separated paragraphs in plain text. */
export function paragraphCount(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

/** Whether the text contains any HTML-like tag. */
export function containsHtml(text: string): boolean {
  return /<[a-z!/][^>]*>/i.test(text);
}
