export const LOCAL_PG_DATABASE_URL =
  "postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public";
export const LOCAL_PG_SCHEMA_PATH = "prisma/postgresql/schema.prisma";
export const LOCAL_REDIS_URL = "redis://localhost:6379";

const LOCAL_PG_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOCAL_PG_PORT = "55432";
const LOCAL_SQLITE_FILES = new Set(["./dev.db", "dev.db", "./prisma/dev.db", "prisma/dev.db"]);

export type LocalSeedPlan = {
  users: number;
  sessions: number;
  articles: number;
  tags: number;
  progressRows: number;
  adminWorkflowRows: number;
};

export type LocalSeedDataset = {
  users: {
    id: string;
    name: string;
    email: string;
    role: "Admin" | "Reader";
    englishLevel: string;
    topics: string[];
  }[];
  sessions: { id: string; sessionToken: string; userId: string; expires: string }[];
  articles: {
    id: string;
    slug: string;
    title: string;
    author: string;
    source: string;
    sourceUrl: string;
    excerpt: string;
    content: string;
    category: string;
    wordCount: number;
    readingMinutes: number;
    difficulty: string;
    difficultyScore: number;
    visibility: "PUBLIC" | "PRIVATE" | "UNLISTED" | "ORG";
    status: "DRAFT" | "PROCESSING" | "PUBLISHED" | "FAILED" | "ARCHIVED";
    sourceType: "SCRAPED" | "IMPORTED" | "MANUAL" | "RSS" | "ASSIGNMENT";
    publishedAt: string | null;
    ownerId: string | null;
  }[];
  tags: { id: string; name: string; slug: string }[];
  articleTags: { articleId: string; tagId: string }[];
  progress: {
    id: string;
    userId: string;
    articleId: string;
    percent: number;
    completed: boolean;
    completedAt: string | null;
  }[];
  savedWords: {
    id: string;
    userId: string;
    word: string;
    explanation: string;
    example: string;
    articleId: string;
  }[];
  vocabulary: {
    id: string;
    articleId: string;
    word: string;
    explanation: string;
    example: string;
  }[];
  quizQuestions: {
    id: string;
    articleId: string;
    question: string;
    options: string[];
    correctIndex: number;
  }[];
  translations: {
    id: string;
    articleId: string;
    targetLang: string;
    content: string;
    model: string;
  }[];
  speech: {
    id: string;
    articleId: string;
    voice: string;
    format: string;
    mimeType: string;
    audioBase64: string;
    plainText: string;
    words: { word: string; offset: number; duration: number }[];
  }[];
  readingLists: { id: string; userId: string; name: string; isDefault: boolean }[];
  readingListItems: { id: string; listId: string; articleId: string }[];
  highlights: {
    id: string;
    userId: string;
    articleId: string;
    quote: string;
    startOffset: number;
    endOffset: number;
    prefix: string;
    suffix: string;
    note: string;
    color: string;
  }[];
  quizAttempts: {
    id: string;
    userId: string;
    articleId: string;
    correctCount: number;
    totalQuestions: number;
    scorePct: number;
    completedAt: string;
  }[];
  difficultyFeedback: {
    id: string;
    userId: string;
    articleId: string;
    vote: "too_easy" | "just_right" | "too_hard";
  }[];
  auditLogs: {
    id: string;
    action: string;
    actorId: string;
    actorRole: "Admin" | "Reader";
    targetType: string;
    targetId: string;
    metadata: string;
    requestId: string;
  }[];
};

export const LOCAL_SEED_DATASET: LocalSeedDataset = {
  users: [
    {
      id: "local-user-admin",
      name: "Local Admin",
      email: "admin@readwise.localhost",
      role: "Admin",
      englishLevel: "C1",
      topics: ["business", "tech", "science"],
    },
    {
      id: "local-user-reader",
      name: "Local Reader",
      email: "reader@readwise.localhost",
      role: "Reader",
      englishLevel: "B1",
      topics: ["world", "science", "culture"],
    },
    {
      id: "local-user-removable",
      name: "Workflow Reader",
      email: "workflow-reader@readwise.localhost",
      role: "Reader",
      englishLevel: "A2",
      topics: ["sports", "health"],
    },
  ],
  sessions: [
    {
      id: "local-session-admin",
      sessionToken: "readwise-local-admin-session",
      userId: "local-user-admin",
      expires: "2036-01-01T00:00:00.000Z",
    },
    {
      id: "local-session-reader",
      sessionToken: "readwise-local-reader-session",
      userId: "local-user-reader",
      expires: "2036-01-01T00:00:00.000Z",
    },
  ],
  articles: [
    {
      id: "local-article-published-1",
      slug: "local-ocean-robots",
      title: "Ocean Robots Map a Changing Reef",
      author: "ReadWise Local",
      source: "ReadWise Seed",
      sourceUrl: "https://local.readwise.invalid/articles/ocean-robots",
      excerpt: "Researchers use small autonomous robots to measure reef health.",
      content:
        "<p>Small autonomous robots are helping researchers map a reef in detail.</p><p>The project gives students clear examples of cause, evidence, and result.</p>",
      category: "science",
      wordCount: 86,
      readingMinutes: 1,
      difficulty: "B1",
      difficultyScore: 46,
      visibility: "PUBLIC",
      status: "PUBLISHED",
      sourceType: "MANUAL",
      publishedAt: "2026-01-05T09:00:00.000Z",
      ownerId: null,
    },
    {
      id: "local-article-published-2",
      slug: "local-city-bikes",
      title: "City Bikes Help Commuters Save Time",
      author: "ReadWise Local",
      source: "ReadWise Seed",
      sourceUrl: "https://local.readwise.invalid/articles/city-bikes",
      excerpt: "A simple transport story for reader progress and saved words.",
      content:
        "<p>The city added safe bike lanes near train stations.</p><p>Commuters reported shorter trips and more predictable mornings.</p>",
      category: "world",
      wordCount: 72,
      readingMinutes: 1,
      difficulty: "A2",
      difficultyScore: 32,
      visibility: "PUBLIC",
      status: "PUBLISHED",
      sourceType: "MANUAL",
      publishedAt: "2026-01-04T09:00:00.000Z",
      ownerId: null,
    },
    {
      id: "local-article-draft",
      slug: "local-admin-draft",
      title: "Draft: Admin Review Queue Sample",
      author: "ReadWise Local",
      source: "ReadWise Seed",
      sourceUrl: "https://local.readwise.invalid/articles/admin-draft",
      excerpt: "Draft article visible in admin article filters.",
      content: "<p>This draft is intentionally unpublished for admin workflow testing.</p>",
      category: "business",
      wordCount: 54,
      readingMinutes: 1,
      difficulty: "B2",
      difficultyScore: 61,
      visibility: "PUBLIC",
      status: "DRAFT",
      sourceType: "MANUAL",
      publishedAt: null,
      ownerId: null,
    },
    {
      id: "local-article-failed",
      slug: "local-admin-failed",
      title: "Failed: Enrichment Retry Sample",
      author: "ReadWise Local",
      source: "ReadWise Seed",
      sourceUrl: "https://local.readwise.invalid/articles/admin-failed",
      excerpt: "Failed article visible in admin filters and rebuild flows.",
      content: "<p>This article represents an enrichment failure for local testing.</p>",
      category: "tech",
      wordCount: 58,
      readingMinutes: 1,
      difficulty: "C1",
      difficultyScore: 78,
      visibility: "PUBLIC",
      status: "FAILED",
      sourceType: "MANUAL",
      publishedAt: null,
      ownerId: null,
    },
    {
      id: "local-article-archived",
      slug: "local-admin-archived",
      title: "Archived: Cleanup Workflow Sample",
      author: "ReadWise Local",
      source: "ReadWise Seed",
      sourceUrl: "https://local.readwise.invalid/articles/admin-archived",
      excerpt: "Archived article for destructive admin action testing.",
      content: "<p>This archived article is safe to delete and restore by reseeding.</p>",
      category: "culture",
      wordCount: 52,
      readingMinutes: 1,
      difficulty: "B1",
      difficultyScore: 45,
      visibility: "PUBLIC",
      status: "ARCHIVED",
      sourceType: "MANUAL",
      publishedAt: "2025-12-30T09:00:00.000Z",
      ownerId: null,
    },
    {
      id: "local-article-private-reader",
      slug: "local-reader-private-note",
      title: "Reader Private Import Sample",
      author: "Local Reader",
      source: "Manual Import",
      sourceUrl: "https://local.readwise.invalid/articles/private-reader-note",
      excerpt: "Private import used to verify owner-scoped visibility.",
      content: "<p>This private import belongs to the seeded reader.</p>",
      category: "health",
      wordCount: 50,
      readingMinutes: 1,
      difficulty: "A2",
      difficultyScore: 28,
      visibility: "PRIVATE",
      status: "PUBLISHED",
      sourceType: "IMPORTED",
      publishedAt: "2026-01-03T09:00:00.000Z",
      ownerId: "local-user-reader",
    },
  ],
  tags: [
    { id: "local-tag-science", name: "Science", slug: "science" },
    { id: "local-tag-commuting", name: "Commuting", slug: "commuting" },
    { id: "local-tag-admin-review", name: "Admin Review", slug: "admin-review" },
    { id: "local-tag-merge-source", name: "Merge Source", slug: "merge-source" },
    { id: "local-tag-merge-target", name: "Merge Target", slug: "merge-target" },
  ],
  articleTags: [
    { articleId: "local-article-published-1", tagId: "local-tag-science" },
    { articleId: "local-article-published-2", tagId: "local-tag-commuting" },
    { articleId: "local-article-draft", tagId: "local-tag-admin-review" },
    { articleId: "local-article-failed", tagId: "local-tag-admin-review" },
    { articleId: "local-article-archived", tagId: "local-tag-merge-source" },
    { articleId: "local-article-published-1", tagId: "local-tag-merge-target" },
  ],
  progress: [
    {
      id: "local-progress-reader-complete",
      userId: "local-user-reader",
      articleId: "local-article-published-1",
      percent: 100,
      completed: true,
      completedAt: "2026-01-06T10:00:00.000Z",
    },
    {
      id: "local-progress-reader-started",
      userId: "local-user-reader",
      articleId: "local-article-published-2",
      percent: 42,
      completed: false,
      completedAt: null,
    },
    {
      id: "local-progress-admin-started",
      userId: "local-user-admin",
      articleId: "local-article-published-1",
      percent: 18,
      completed: false,
      completedAt: null,
    },
  ],
  savedWords: [
    {
      id: "local-saved-word-reader-autonomous",
      userId: "local-user-reader",
      word: "autonomous",
      explanation: "Able to work independently.",
      example: "Autonomous robots mapped the reef.",
      articleId: "local-article-published-1",
    },
    {
      id: "local-saved-word-reader-commuter",
      userId: "local-user-reader",
      word: "commuter",
      explanation: "A person who travels regularly to work or school.",
      example: "Each commuter saved time.",
      articleId: "local-article-published-2",
    },
  ],
  vocabulary: [
    {
      id: "local-vocab-reef",
      articleId: "local-article-published-1",
      word: "reef",
      explanation: "A line of rocks or coral near the surface of the sea.",
      example: "The reef was mapped by robots.",
    },
    {
      id: "local-vocab-lanes",
      articleId: "local-article-published-2",
      word: "lanes",
      explanation: "Marked parts of a road for a specific kind of traffic.",
      example: "The bike lanes were safe.",
    },
  ],
  quizQuestions: [
    {
      id: "local-quiz-reef-purpose",
      articleId: "local-article-published-1",
      question: "Why did researchers use robots?",
      options: ["To map the reef", "To sell bikes", "To write laws"],
      correctIndex: 0,
    },
    {
      id: "local-quiz-bike-result",
      articleId: "local-article-published-2",
      question: "What changed for commuters?",
      options: ["Trips became shorter", "Trains closed", "Weather changed"],
      correctIndex: 0,
    },
  ],
  translations: [
    {
      id: "local-translation-reef-es",
      articleId: "local-article-published-1",
      targetLang: "es",
      content: "Pequeños robots autónomos ayudan a investigadores a estudiar un arrecife.",
      model: "local-seed",
    },
  ],
  speech: [
    {
      id: "local-speech-reef",
      articleId: "local-article-published-1",
      voice: "local-seed-voice",
      format: "audio-24khz-96kbitrate-mono-mp3",
      mimeType: "audio/mpeg",
      audioBase64: "SUQzBAAAAAAA",
      plainText: "Small autonomous robots map a reef.",
      words: [
        { word: "Small", offset: 0, duration: 400 },
        { word: "autonomous", offset: 400, duration: 700 },
        { word: "robots", offset: 1100, duration: 400 },
      ],
    },
  ],
  readingLists: [
    {
      id: "local-list-reader-default",
      userId: "local-user-reader",
      name: "Read Later",
      isDefault: true,
    },
  ],
  readingListItems: [
    {
      id: "local-list-item-reader-city-bikes",
      listId: "local-list-reader-default",
      articleId: "local-article-published-2",
    },
  ],
  highlights: [
    {
      id: "local-highlight-reader-reef",
      userId: "local-user-reader",
      articleId: "local-article-published-1",
      quote: "autonomous robots",
      startOffset: 6,
      endOffset: 23,
      prefix: "Small ",
      suffix: " are helping",
      note: "Good phrase for technology articles.",
      color: "yellow",
    },
  ],
  quizAttempts: [
    {
      id: "local-quiz-attempt-reader-reef",
      userId: "local-user-reader",
      articleId: "local-article-published-1",
      correctCount: 1,
      totalQuestions: 1,
      scorePct: 100,
      completedAt: "2026-01-06T10:05:00.000Z",
    },
  ],
  difficultyFeedback: [
    {
      id: "local-feedback-reader-reef",
      userId: "local-user-reader",
      articleId: "local-article-published-1",
      vote: "just_right",
    },
    {
      id: "local-feedback-admin-reef",
      userId: "local-user-admin",
      articleId: "local-article-published-1",
      vote: "too_easy",
    },
  ],
  auditLogs: [
    {
      id: "local-audit-article-rebuild",
      action: "admin.article.rebuild",
      actorId: "local-user-admin",
      actorRole: "Admin",
      targetType: "Article",
      targetId: "local-article-failed",
      metadata: "{\"seeded\":true,\"workflow\":\"rebuild\"}",
      requestId: "local-seed-request",
    },
    {
      id: "local-audit-member-role",
      action: "admin.member.role_update",
      actorId: "local-user-admin",
      actorRole: "Admin",
      targetType: "User",
      targetId: "local-user-removable",
      metadata: "{\"seeded\":true,\"workflow\":\"member\"}",
      requestId: "local-seed-request",
    },
  ],
};

export function getLocalSeedPlan(dataset: LocalSeedDataset = LOCAL_SEED_DATASET): LocalSeedPlan {
  return {
    users: dataset.users.length,
    sessions: dataset.sessions.length,
    articles: dataset.articles.length,
    tags: dataset.tags.length,
    progressRows: dataset.progress.length,
    adminWorkflowRows:
      dataset.articles.filter((a) => a.status !== "PUBLISHED").length +
      dataset.auditLogs.length +
      dataset.difficultyFeedback.length,
  };
}

export function isSafeLocalDatabaseUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  if (rawUrl.startsWith("file:")) {
    const sqlitePath = rawUrl.slice("file:".length);
    return LOCAL_SQLITE_FILES.has(sqlitePath);
  }
  try {
    const url = new URL(rawUrl);
    const isPostgres = url.protocol === "postgresql:" || url.protocol === "postgres:";
    return (
      isPostgres &&
      LOCAL_PG_HOSTS.has(url.hostname) &&
      url.port === LOCAL_PG_PORT &&
      url.username === "readwise" &&
      url.password === "readwise-dev-password" &&
      url.pathname === "/readwise"
    );
  } catch {
    return false;
  }
}
