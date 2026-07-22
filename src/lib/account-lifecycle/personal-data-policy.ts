import type { Prisma } from "@prisma/client";

/** Explicit allowlist for the user-owned data export. */
export const USER_EXPORT_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  accounts: {
    select: {
      provider: true,
      type: true,
    },
  },
  profile: {
    select: {
      ageRange: true,
      gender: true,
      englishLevel: true,
      topics: true,
      dailyGoal: true,
      goalPath: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  savedWords: {
    select: {
      word: true,
      explanation: true,
      example: true,
      articleId: true,
      dueAt: true,
      intervalDays: true,
      easeFactor: true,
      repetitions: true,
      lastReviewedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  readingProgress: {
    select: {
      articleId: true,
      percent: true,
      completed: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  dailyActivities: {
    select: {
      date: true,
      articlesRead: true,
      createdAt: true,
    },
    orderBy: { date: "asc" },
  },
  readingLists: {
    select: {
      name: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          articleId: true,
          addedAt: true,
        },
        orderBy: { addedAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  highlights: {
    select: {
      articleId: true,
      quote: true,
      startOffset: true,
      endOffset: true,
      prefix: true,
      suffix: true,
      note: true,
      color: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  tutorMessages: {
    select: {
      articleId: true,
      role: true,
      content: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  quizAttempts: {
    select: {
      articleId: true,
      correctCount: true,
      totalQuestions: true,
      scorePct: true,
      completedAt: true,
    },
    orderBy: { completedAt: "asc" },
  },
  pronunciationAttempts: {
    select: {
      articleId: true,
      referenceText: true,
      accuracyScore: true,
      fluencyScore: true,
      completenessScore: true,
      pronScore: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  reminderPreference: {
    select: {
      enabled: true,
      preferredHour: true,
      quietHoursStart: true,
      quietHoursEnd: true,
      timezone: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  levelHistory: {
    select: { level: true, changedAt: true },
    orderBy: { changedAt: "asc" },
  },
  wordMastery: {
    select: {
      lemma: true,
      familiarity: true,
      confidence: true,
      exposures: true,
      correctReviews: true,
      incorrectReviews: true,
      sourceArticleIds: true,
      lastSeenAt: true,
      lastReviewedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { lemma: "asc" },
  },
  articleMastery: {
    select: {
      articleId: true,
      readingCompletion: true,
      quizScore: true,
      lookupDensity: true,
      timeSpentMs: true,
      difficultyFeedback: true,
      comprehensionScore: true,
      lastActivityAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { lastActivityAt: "asc" },
  },
  skillMastery: {
    select: {
      skill: true,
      confidence: true,
      evidenceCount: true,
      recentEvidence: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { skill: "asc" },
  },
  learnerCoachMemories: {
    select: {
      skill: true,
      confidence: true,
      evidenceCount: true,
      lastObservedAt: true,
      trend: true,
      createdAt: true,
    },
    orderBy: { skill: "asc" },
  },
  studyPlanSnapshots: {
    select: {
      weekStart: true,
      weekEnd: true,
      generatedAt: true,
      summary: true,
      isStarter: true,
      weakAreas: true,
      items: true,
      sourceVersion: true,
      createdAt: true,
    },
    orderBy: { weekStart: "asc" },
  },
  difficultyFeedback: {
    select: {
      articleId: true,
      vote: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  todayComprehensionFeedback: {
    select: {
      todaySessionId: true,
      articleId: true,
      selfRating: true,
      questionId: true,
      mcqCorrect: true,
      skillTag: true,
      remediationViewed: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  memberships: {
    select: {
      orgId: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  classroomMemberships: {
    select: {
      classroomId: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  assignmentCompletions: {
    select: {
      assignmentId: true,
      status: true,
      quizScore: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  assignmentTargets: {
    select: {
      assignmentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  placementResult: {
    select: {
      seedLevel: true,
      recommendedLevel: true,
      questionCount: true,
      correctCount: true,
      skipped: true,
      completedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

/** User relations intentionally excluded from the export, with policy reasons. */
export const USER_EXPORT_RELATION_EXCLUSIONS = {
  sessions: "Session tokens are authentication secrets.",
  pushSubscriptions: "Push endpoints and keys are authentication material.",
  ownedArticles: "Article text is not duplicated into personal-data exports.",
  ownedTags: "Private tag records are not part of the current export contract.",
  taughtClassrooms: "Classrooms are tenant resources rather than user-owned records.",
  todaySessions: "Daily workflow anchors are not part of the current export contract.",
  seriesEnrollments: "Reading-series progress is not part of the current export contract.",
} as const;

export type PersonalDataPolicyCheck = {
  ok: boolean;
  diagnostics: string[];
};

type ExportCoverageOptions = {
  select?: Record<string, unknown>;
  exclusions?: Record<string, string>;
};

function schemaModelNames(schema: string): Set<string> {
  return new Set(
    [...schema.matchAll(/^\s*model\s+([A-Za-z_]\w*)\s*\{/gm)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name)),
  );
}

function modelRelationFields(schema: string, modelName: string): string[] | null {
  const models = schemaModelNames(schema);
  const lines = schema.split(/\r?\n/);
  let inModel = false;
  const relations: string[] = [];

  for (const line of lines) {
    if (!inModel) {
      inModel = new RegExp(`^\\s*model\\s+${modelName}\\s*\\{`).test(line);
      continue;
    }
    if (/^\s*}/.test(line)) return relations;
    const field = line.match(/^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?:\[\]|\?)?(?:\s|$)/);
    const fieldName = field?.[1];
    const fieldType = field?.[2];
    if (fieldName && fieldType && models.has(fieldType)) relations.push(fieldName);
  }

  return null;
}

/**
 * Checks that every Prisma `User` relation has an explicit export decision.
 * Prisma remains authoritative for relation and cascade structure; this check
 * derives relation names from the schema instead of maintaining a model list.
 */
export function inspectPersonalDataExportCoverage(
  schema: string,
  options: ExportCoverageOptions = {},
): PersonalDataPolicyCheck {
  if (!schemaModelNames(schema).has("User")) {
    return { ok: true, diagnostics: [] };
  }
  const relations = modelRelationFields(schema, "User");
  if (relations === null) {
    return {
      ok: false,
      diagnostics: ["  Prisma User model is not terminated with a closing brace."],
    };
  }

  const select = options.select ?? USER_EXPORT_SELECT;
  const exclusions: Readonly<Record<string, string>> =
    options.exclusions ?? USER_EXPORT_RELATION_EXCLUSIONS;
  const relationSet = new Set(relations);
  const selected = new Set(Object.keys(select).filter((key) => relationSet.has(key)));
  const excluded = new Set(Object.keys(exclusions));
  const diagnostics: string[] = [];

  for (const relation of relations) {
    if (selected.has(relation) && excluded.has(relation)) {
      diagnostics.push(`  User.${relation} is both exported and explicitly excluded.`);
    } else if (!selected.has(relation) && !excluded.has(relation)) {
      diagnostics.push(`  User.${relation} has no personal-data export decision.`);
    }
  }
  for (const relation of excluded) {
    if (!relationSet.has(relation)) {
      diagnostics.push(`  Export exclusion User.${relation} is not a Prisma User relation.`);
    }
    if (!exclusions[relation]?.trim()) {
      diagnostics.push(`  Export exclusion User.${relation} must include a reason.`);
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}