/** Classroom article-assignment invariant over authorized classroom context. */

import {
  ArticleStatus,
  ArticleVisibility,
  AssignmentPublishState,
  type Assignment,
  type Prisma,
} from "@prisma/client";
import {
  getOrganizationAssignableArticle,
  type ArticleOrganizationIntegrityReason,
} from "@/lib/article-library/tenant-integrity";
import {
  readableArticleWhere,
  type ArticleAccessContext,
} from "@/lib/article-library/policy";
import { prisma } from "@/lib/prisma";

export type CreateArticleAssignmentInput = {
  classroomId: string;
  organizationId: string;
  articleId: string;
  accessContext: ArticleAccessContext;
  dueDate?: string;
  instructions?: string | null;
  title?: string | null;
  points?: number | null;
  studentIds?: string[];
  publishState?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  publishAt?: string | null;
};

export type CreateArticleAssignmentResult =
  | { ok: true; assignment: Assignment }
  | {
      ok: false;
      status: 400;
      reason: "invalid_due_date" | "invalid_target_students" | "invalid_publish_at";
    }
  | {
      ok: false;
      status: 404 | 409;
      reason: "article_not_found" | ArticleOrganizationIntegrityReason;
    };

export type BulkCreateArticleAssignmentsInput = {
  classroomId: string;
  organizationId: string;
  articleIds: string[];
  accessContext: ArticleAccessContext;
  dueDate?: string;
  instructions?: string | null;
  points?: number | null;
  studentIds?: string[];
  publishState?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  publishAt?: string | null;
};

export type BulkCreateArticleAssignmentsResult = {
  created: Assignment[];
  failed: { articleId: string; reason: string }[];
};

export function parseOptionalDueDate(dueDate: string | undefined): Date | null {
  if (!dueDate) return null;
  // Date-only strings (from <input type="date">) parse as midnight UTC, which
  // flags assignments overdue a day early west of UTC. Resolve them to
  // end-of-day UTC so students get the full calendar day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
    ? `${dueDate}T23:59:59.999Z`
    : dueDate;
  const parsed = new Date(dateOnly);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function trimOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function parseAssignmentPublish(input: {
  publishState?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  publishAt?: string | null;
  now?: Date;
}):
  | { ok: true; publishState: AssignmentPublishState; publishAt: Date | null }
  | { ok: false; status: 400; reason: "invalid_publish_at" } {
  const publishState = input.publishState ?? "PUBLISHED";
  if (publishState === "DRAFT") {
    return { ok: true, publishState: AssignmentPublishState.DRAFT, publishAt: null };
  }
  if (publishState === "PUBLISHED") {
    return { ok: true, publishState: AssignmentPublishState.PUBLISHED, publishAt: null };
  }

  const parsed = input.publishAt ? new Date(input.publishAt) : null;
  const now = input.now ?? new Date();
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed <= now) {
    return { ok: false, status: 400, reason: "invalid_publish_at" };
  }
  return { ok: true, publishState: AssignmentPublishState.SCHEDULED, publishAt: parsed };
}

function assignableArticleWhere(input: {
  articleId: string;
  organizationId: string;
  accessContext: ArticleAccessContext;
}): Prisma.ArticleWhereInput {
  return readableArticleWhere(input.accessContext, {
    id: input.articleId,
    status: ArticleStatus.PUBLISHED,
    OR: [
      {
        visibility: { in: [ArticleVisibility.PUBLIC, ArticleVisibility.UNLISTED] },
        ownerId: null,
        organizationId: null,
      },
      {
        visibility: ArticleVisibility.ORG,
        organizationId: input.organizationId,
      },
    ],
  });
}

async function canAssignReadableArticle(input: {
  articleId: string;
  organizationId: string;
  accessContext: ArticleAccessContext;
}): Promise<boolean> {
  const article = await prisma.article.findFirst({
    where: assignableArticleWhere(input),
    select: { id: true },
  });
  return Boolean(article);
}

/**
 * Creates an assignment only after Article Library confirms that the article
 * is readable/assignable to the authorized classroom's organization.
 */
export async function createArticleAssignment(
  input: CreateArticleAssignmentInput,
): Promise<CreateArticleAssignmentResult> {
  const article = await getOrganizationAssignableArticle(
    input.articleId,
    input.organizationId,
  );
  if (!article.ok) return article;
  if (!(await canAssignReadableArticle(input))) {
    return { ok: false, status: 404, reason: "article_not_found" };
  }

  const dueDate = parseOptionalDueDate(input.dueDate);
  if (input.dueDate && !dueDate) {
    return { ok: false, status: 400, reason: "invalid_due_date" };
  }
  const publish = parseAssignmentPublish(input);
  if (!publish.ok) return publish;

  const requestedStudentIds = input.studentIds?.length
    ? [...new Set(input.studentIds)]
    : [];
  if (requestedStudentIds.length > 0) {
    const enrolledTargets = await prisma.classroomMembership.findMany({
      where: {
        classroomId: input.classroomId,
        role: "Student",
        userId: { in: requestedStudentIds },
      },
      select: { userId: true },
    });
    const enrolledIds = new Set(enrolledTargets.map((target) => target.userId));
    const targetStudentIds = requestedStudentIds.filter((studentId) =>
      enrolledIds.has(studentId),
    );

    if (targetStudentIds.length === 0) {
      return { ok: false, status: 400, reason: "invalid_target_students" };
    }

    const assignment = await prisma.$transaction(async (tx) => {
      const created = await tx.assignment.create({
        data: {
          classroomId: input.classroomId,
          articleId: input.articleId,
          dueDate,
          instructions: trimOrNull(input.instructions),
          title: trimOrNull(input.title),
          points: input.points ?? null,
          publishState: publish.publishState,
          publishAt: publish.publishAt,
        },
      });
      await tx.assignmentTarget.createMany({
        data: targetStudentIds.map((studentId) => ({
          assignmentId: created.id,
          studentId,
        })),
      });
      return created;
    });
    return { ok: true, assignment };
  }

  const assignment = await prisma.assignment.create({
    data: {
      classroomId: input.classroomId,
      articleId: input.articleId,
      dueDate,
      instructions: trimOrNull(input.instructions),
      title: trimOrNull(input.title),
      points: input.points ?? null,
      publishState: publish.publishState,
      publishAt: publish.publishAt,
    },
  });
  return { ok: true, assignment };
}

export async function bulkCreateArticleAssignments(
  input: BulkCreateArticleAssignmentsInput,
): Promise<BulkCreateArticleAssignmentsResult> {
  const created: Assignment[] = [];
  const failed: { articleId: string; reason: string }[] = [];

  for (const articleId of input.articleIds) {
    const result = await createArticleAssignment({
      classroomId: input.classroomId,
      organizationId: input.organizationId,
      articleId,
      accessContext: input.accessContext,
      dueDate: input.dueDate,
      instructions: input.instructions,
      points: input.points,
      studentIds: input.studentIds,
      publishState: input.publishState,
      publishAt: input.publishAt,
    });

    if (result.ok) {
      created.push(result.assignment);
    } else {
      failed.push({ articleId, reason: result.reason });
    }
  }

  return { created, failed };
}