/** Classroom article-assignment invariant over authorized classroom context. */

import type { Assignment } from "@prisma/client";
import {
  getOrganizationAssignableArticle,
  type ArticleOrganizationIntegrityReason,
} from "@/lib/article-library/tenant-integrity";
import { prisma } from "@/lib/prisma";

export type CreateArticleAssignmentInput = {
  classroomId: string;
  organizationId: string;
  articleId: string;
  dueDate?: string;
  instructions?: string | null;
};

export type CreateArticleAssignmentResult =
  | { ok: true; assignment: Assignment }
  | {
      ok: false;
      status: 400;
      reason: "invalid_due_date";
    }
  | {
      ok: false;
      status: 404 | 409;
      reason: "article_not_found" | ArticleOrganizationIntegrityReason;
    };

function parseOptionalDueDate(dueDate: string | undefined): Date | null {
  if (!dueDate) return null;
  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function trimOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Creates an assignment only after Article Library confirms that the article
 * is assignable to the authorized classroom's organization.
 */
export async function createArticleAssignment(
  input: CreateArticleAssignmentInput,
): Promise<CreateArticleAssignmentResult> {
  const article = await getOrganizationAssignableArticle(
    input.articleId,
    input.organizationId,
  );
  if (!article.ok) return article;

  const dueDate = parseOptionalDueDate(input.dueDate);
  if (input.dueDate && !dueDate) {
    return { ok: false, status: 400, reason: "invalid_due_date" };
  }

  const assignment = await prisma.assignment.create({
    data: {
      classroomId: input.classroomId,
      articleId: input.articleId,
      dueDate,
      instructions: trimOrNull(input.instructions),
    },
  });
  return { ok: true, assignment };
}