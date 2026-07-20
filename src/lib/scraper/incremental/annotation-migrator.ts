/**
 * Annotation migrator — the #1103 re-anchoring seam implementation.
 *
 * The thin IMPURE adapter that plugs the pure {@link buildReanchorPlan} core into
 * the force-rescrape runner's `annotationMigrator` seam. It loads an Article's
 * highlight/note anchors from Prisma and derives the PROPOSED content version's
 * plain text the SAME way the Reader does (so char offsets line up), then returns
 * the aggregate re-anchoring plan the activation gate consumes.
 *
 * MODULE BOUNDARY: the reader derives its plain text with
 * `articleHtmlToReaderText` from `@/lib/content-pipeline`, which `src/lib/scraper/*`
 * may NOT import (one-way ownership boundary — see
 * `tests/scraper-content-boundaries.test.ts`). It is therefore INJECTED as
 * `deriveReaderText`; the admin route (app layer, allowed to import the pipeline)
 * supplies the real implementation, and tests supply a fake.
 *
 * PRIVACY: highlight quote/note text is read ONLY to compute offsets in memory —
 * it is NEVER returned, logged, or persisted. The returned plan carries anchor
 * IDs + counts + offsets only.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  buildReanchorPlan,
  type ReanchorAnchorInput,
  type ReanchorPlan,
} from "./annotation-reanchor";

/** Derives Reader plain text from an Article content version's readable body. */
export type DeriveReaderText = (content: string) => string;

/**
 * The #1103 annotation re-anchoring seam. `assess` re-anchors every one of an
 * Article's highlight/note anchors onto the PROPOSED content and returns the
 * aggregate plan: whether all anchors migrated reliably (gate may pass), the
 * offset moves to apply atomically at activation, and the IDs of any anchors
 * that could not be reliably migrated (block activation, surface for
 * confirmation). Its mere PRESENCE opens the annotation-migration gate; a
 * non-reliable assessment still blocks it.
 */
export type AnnotationMigrator = {
  assess(input: { articleId: string; proposedContent: string }): Promise<ReanchorPlan>;
};

/** Anchor columns needed to re-anchor — includes `userId` for collision scope. */
const ANCHOR_SELECT = {
  id: true,
  userId: true,
  quote: true,
  startOffset: true,
  endOffset: true,
  prefix: true,
  suffix: true,
} satisfies Prisma.HighlightSelect;

/**
 * Builds a production {@link AnnotationMigrator} backed by Prisma + the injected
 * Reader text deriver. Loads the Article's anchors (reads-before-tx — the runner
 * calls this BEFORE the activation transaction), derives the proposed plain text,
 * and returns {@link buildReanchorPlan}.
 */
export function createAnnotationMigrator(deps: {
  deriveReaderText: DeriveReaderText;
}): AnnotationMigrator {
  return {
    async assess({ articleId, proposedContent }) {
      const rows = await prisma.highlight.findMany({
        where: { articleId },
        select: ANCHOR_SELECT,
      });
      const plainText = deps.deriveReaderText(proposedContent);
      const anchors: ReanchorAnchorInput[] = rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        quote: row.quote,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
        prefix: row.prefix,
        suffix: row.suffix,
      }));
      return buildReanchorPlan(anchors, plainText);
    },
  };
}
