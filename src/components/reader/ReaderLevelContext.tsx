"use client";

/**
 * Reader level context (#1303): the reading level the reader is showing, so
 * level-scoped tools (quiz, highlights, class prompts) request the matching
 * data. Defaults to the original text outside the reader.
 */

import { createContext, useContext, type ReactNode } from "react";
import { ORIGINAL_LEVEL, type ReadingLevelKey } from "@/lib/article-levels/levels";

const ReaderLevelContext = createContext<ReadingLevelKey>(ORIGINAL_LEVEL);

export function ReaderLevelProvider({ level, children }: { level: ReadingLevelKey; children: ReactNode }) {
  return <ReaderLevelContext.Provider value={level}>{children}</ReaderLevelContext.Provider>;
}

export function useReaderLevel(): ReadingLevelKey {
  return useContext(ReaderLevelContext);
}
