"use client";

/**
 * ReaderClassAnnotationsProvider (#1307)
 *
 * Loads classroom annotations for the article: guided prompts from the
 * viewer's teachers (or the viewer's own classrooms when teaching) and the
 * viewer's replies/evidence. Consumers:
 *  - WordLookup paints prompts as `mark.rw-guide` in the prose
 *  - ReaderNotesPanel lists prompts, replies, and evidence actions
 *  - ClassPromptsNotice points learners and teachers at the Notes tab
 *
 * Optional feature: a failed load leaves an empty context and the reader
 * works as before. `useClassAnnotations` returns that empty context outside
 * the provider.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/client-fetch";
import type { GuideMark } from "@/components/reader/wordLookup/highlightMarks";
import { ORIGINAL_LEVEL, levelQuery, type ReadingLevelKey } from "@/lib/article-levels/levels";

export type ClassAssignment = { assignmentId: string; classroomName: string };

export type ClassAnchor = {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
};

export type ClassGuide = ClassAnchor & {
  id: string;
  assignmentId: string;
  classroomName: string;
  prompt: string;
  canEdit: boolean;
  /** 1-based position in document order (shown on the inline mark). */
  number: number;
};

export type ClassResponse = {
  id: string;
  assignmentId: string;
  annotationId: string | null;
  quote: string | null;
  body: string;
  createdAt: string;
};

type ContextPayload = {
  teaching: ClassAssignment[];
  learning: ClassAssignment[];
  guides: Array<Omit<ClassGuide, "number">>;
  responses: ClassResponse[];
};

export type SubmitResponseInput = {
  annotationId?: string | null;
  anchor?: ClassAnchor | null;
  body: string;
};

interface ClassAnnotationsValue {
  loaded: boolean;
  teaching: ClassAssignment[];
  learning: ClassAssignment[];
  guides: ClassGuide[];
  /** Guides in mark form for the prose renderer (stable between loads). */
  guideMarks: GuideMark[];
  responses: ClassResponse[];
  createGuide: (assignmentId: string, anchor: ClassAnchor, prompt: string) => Promise<void>;
  updateGuide: (id: string, prompt: string) => Promise<void>;
  deleteGuide: (id: string) => Promise<void>;
  submitResponse: (assignmentId: string, input: SubmitResponseInput) => Promise<void>;
  deleteResponse: (id: string) => Promise<void>;
}

const EMPTY: ContextPayload = { teaching: [], learning: [], guides: [], responses: [] };

const unavailable = async () => {
  throw new Error("Class annotations are unavailable");
};

const EMPTY_VALUE: ClassAnnotationsValue = {
  loaded: false,
  teaching: [],
  learning: [],
  guides: [],
  guideMarks: [],
  responses: [],
  createGuide: unavailable,
  updateGuide: unavailable,
  deleteGuide: unavailable,
  submitResponse: unavailable,
  deleteResponse: unavailable,
};

const ClassAnnotationsContext = createContext<ClassAnnotationsValue>(EMPTY_VALUE);

export function useClassAnnotations(): ClassAnnotationsValue {
  return useContext(ClassAnnotationsContext);
}

function numberGuides(guides: ContextPayload["guides"]): ClassGuide[] {
  return [...guides]
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((guide, index) => ({ ...guide, number: index + 1 }));
}

export function ReaderClassAnnotationsProvider({
  articleId,
  levelKey = ORIGINAL_LEVEL,
  children,
}: {
  articleId: string;
  /** Reading level shown in the reader; prompts and evidence are scoped to it (#1303). */
  levelKey?: ReadingLevelKey;
  children: ReactNode;
}) {
  const [data, setData] = useState<ContextPayload>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const url = `/api/reader/${encodeURIComponent(articleId)}/annotations${levelQuery(levelKey)}`;

  const reload = useCallback(async () => {
    try {
      setData(await getJson<ContextPayload>(url));
    } catch {
      setData(EMPTY);
    } finally {
      setLoaded(true);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createGuide = useCallback(
    async (assignmentId: string, anchor: ClassAnchor, prompt: string) => {
      await postJson(`/api/assignments/${encodeURIComponent(assignmentId)}/annotations`, { ...anchor, levelKey, prompt });
      await reload();
    },
    [reload, levelKey],
  );
  const updateGuide = useCallback(
    async (id: string, prompt: string) => {
      await patchJson(`/api/assignment-annotations/${encodeURIComponent(id)}`, { prompt });
      await reload();
    },
    [reload],
  );
  const deleteGuide = useCallback(
    async (id: string) => {
      await deleteJson(`/api/assignment-annotations/${encodeURIComponent(id)}`);
      await reload();
    },
    [reload],
  );
  const submitResponse = useCallback(
    async (assignmentId: string, input: SubmitResponseInput) => {
      await postJson(`/api/assignments/${encodeURIComponent(assignmentId)}/annotation-responses`, {
        ...input,
        anchor: input.anchor ? { ...input.anchor, levelKey } : input.anchor,
      });
      await reload();
    },
    [reload, levelKey],
  );
  const deleteResponse = useCallback(
    async (id: string) => {
      await deleteJson(`/api/annotation-responses/${encodeURIComponent(id)}`);
      await reload();
    },
    [reload],
  );

  const guides = useMemo(() => numberGuides(data.guides), [data.guides]);
  const guideMarks = useMemo<GuideMark[]>(
    () =>
      guides.map(({ id, quote, startOffset, endOffset, prefix, suffix, number, prompt }) => ({
        id,
        quote,
        startOffset,
        endOffset,
        prefix,
        suffix,
        number,
        prompt,
      })),
    [guides],
  );

  const value = useMemo<ClassAnnotationsValue>(
    () => ({
      loaded,
      teaching: data.teaching,
      learning: data.learning,
      guides,
      guideMarks,
      responses: data.responses,
      createGuide,
      updateGuide,
      deleteGuide,
      submitResponse,
      deleteResponse,
    }),
    [loaded, data, guides, guideMarks, createGuide, updateGuide, deleteGuide, submitResponse, deleteResponse],
  );

  return <ClassAnnotationsContext.Provider value={value}>{children}</ClassAnnotationsContext.Provider>;
}
