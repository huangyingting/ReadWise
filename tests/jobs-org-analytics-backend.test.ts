process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { AssignmentStatus, JobStatus, JobType, Prisma } from "@prisma/client";

type AnyArgs = Record<string, any>;

const logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

let jobFindManyArgs: AnyArgs[];
let jobFindManyRows: Record<string, unknown>[];
let jobFindUniqueArgs: AnyArgs[];
let jobById: Record<string, unknown> | null;
let jobCountArgs: AnyArgs[];
let jobCountResult: number;
let jobCreateArgs: AnyArgs[];
let jobCreateError: Error | null;
let dedupeWinner: Record<string, unknown> | null;
let jobGroupRowsByStatus: Array<{ status: string; _count: { _all: number } }>;
let jobGroupRowsByType: Array<{ type: string; _count: { _all: number } }>;
let jobUpdates: AnyArgs[];
let jobUpdateError: Error | null;
let jobDeletes: AnyArgs[];
let queryRawRows: Array<{ id: string; wasStale: boolean; lockedAt: Date | null }>;
let queryRawCalls: unknown[];
let metricCalls: unknown[];
let organizationsById: Map<string, Record<string, unknown>>;
let organizationsBySlug: Map<string, Record<string, unknown>>;
let membershipsByKey: Map<string, Record<string, unknown> | null>;
let membershipFindManyRows: Record<string, unknown>[];
let membershipUpserts: AnyArgs[];
let profileById: Map<string, Record<string, unknown> | null>;
let currentSession: { user: { id: string; role?: string | null } };
let classroomProgressData: Record<string, any> | null;

function makeJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T12:00:00.000Z");
  return {
    id: "job-1",
    type: JobType.ARTICLE_PROCESS,
    status: JobStatus.FAILED,
    attempts: 1,
    maxAttempts: 5,
    priority: 2,
    payload: { articleId: "article-1", feature: "tags" },
    dedupeKey: "article-process:article-1",
    lastError: "provider timeout",
    runAfter: now,
    lockedBy: "worker-a",
    lockedAt: new Date(now.getTime() - 250),
    startedAt: null,
    completedAt: null,
    failedAt: now,
    deadLetteredAt: null,
    createdAt: now,
    updatedAt: now,
    errorHistory: [],
    ...overrides,
  };
}

before(() => {
  const prisma = {
    $queryRaw: async (query: unknown) => {
      queryRawCalls.push(query);
      return queryRawRows;
    },
    job: {
      count: async (args: AnyArgs) => {
        jobCountArgs.push(args);
        return jobCountResult;
      },
      create: async (args: AnyArgs) => {
        jobCreateArgs.push(args);
        if (jobCreateError) throw jobCreateError;
        return makeJob({ id: `created-${jobCreateArgs.length}`, ...args.data });
      },
      delete: async (args: AnyArgs) => {
        jobDeletes.push(args);
        return jobById;
      },
      findMany: async (args: AnyArgs) => {
        jobFindManyArgs.push(args);
        return jobFindManyRows;
      },
      findUnique: async (args: { where: { id?: string; dedupeKey?: string } }) => {
        jobFindUniqueArgs.push(args);
        if (args.where.dedupeKey) return dedupeWinner;
        return args.where.id ? jobById : null;
      },
      groupBy: async (args: { by: string[] }) =>
        args.by.includes("status") ? jobGroupRowsByStatus : jobGroupRowsByType,
      update: async (args: AnyArgs) => {
        jobUpdates.push(args);
        if (jobUpdateError) throw jobUpdateError;
        return { ...jobById, ...(args.data as Record<string, unknown>) };
      },
      updateMany: async () => ({ count: 1 }),
    },
    organization: {
      findUnique: async (args: { where: { id?: string; slug?: string } }) => {
        if (args.where.slug) return organizationsBySlug.get(args.where.slug) ?? null;
        return organizationsById.get(args.where.id ?? "") ?? null;
      },
    },
    membership: {
      findMany: async () => membershipFindManyRows,
      findUnique: async (args: { where: { userId_orgId: { userId: string; orgId: string } } }) => {
        const { userId, orgId } = args.where.userId_orgId;
        return membershipsByKey.get(`${userId}:${orgId}`) ?? null;
      },
      upsert: async (args: AnyArgs) => {
        membershipUpserts.push(args);
        return { id: "membership-upserted", ...(args.create as Record<string, unknown>) };
      },
    },
    profile: {
      findUnique: async (args: { where: { userId: string } }) =>
        profileById.get(args.where.userId) ?? null,
    },
  };

  mock.module("@/lib/prisma", { namedExports: { prisma } });
  mock.module("@/lib/api-handler", {
    namedExports: {
      ApiError: class ApiError extends Error {
        readonly status: number;
        constructor(status: number, message: string) {
          super(message);
          this.status = status;
        }
      },
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordApiRequest: () => {},
      recordJobLockAge: (...args: unknown[]) => metricCalls.push(["lock-age", ...args]),
      recordJobQueueEvent: (input: unknown) => metricCalls.push(["queue-event", input]),
      routeGroupFromPath: (path: string) => path,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => logger,
      getRequestContext: () => ({}),
      getRequestId: () => null,
      runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
      setRequestContext: () => {},
    },
  });
  mock.module("@/lib/profile", {
    namedExports: {
      parseTopics: (value: unknown) => (Array.isArray(value) ? value : []),
    },
  });
  mock.module("@/lib/classroom", {
    namedExports: {
      getClassroomProgressData: async () => classroomProgressData,
    },
  });
  mock.module("@/lib/org", {
    namedExports: {
      isSystemAdmin: (role: string | null | undefined) => role === "Admin" || role === "System",
    },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect: (url: string) => {
        throw Object.assign(new Error(`redirect:${url}`), { url });
      },
    },
  });
  mock.module("@/lib/session", {
    namedExports: {
      requireSession: async () => currentSession,
    },
  });
});

beforeEach(() => {
  jobFindManyArgs = [];
  jobFindManyRows = [makeJob()];
  jobFindUniqueArgs = [];
  jobById = makeJob();
  jobCountArgs = [];
  jobCountResult = 1;
  jobCreateArgs = [];
  jobCreateError = null;
  dedupeWinner = null;
  jobGroupRowsByStatus = [
    { status: JobStatus.PENDING, _count: { _all: 2 } },
    { status: JobStatus.FAILED, _count: { _all: 1 } },
  ];
  jobGroupRowsByType = [{ type: JobType.ARTICLE_PROCESS, _count: { _all: 3 } }];
  jobUpdates = [];
  jobUpdateError = null;
  jobDeletes = [];
  queryRawRows = [];
  queryRawCalls = [];
  metricCalls = [];
  organizationsById = new Map([["org-1", { id: "org-1", slug: "readers" }]]);
  organizationsBySlug = new Map([["readers", { id: "org-1", slug: "readers" }]]);
  membershipsByKey = new Map();
  membershipFindManyRows = [];
  membershipUpserts = [];
  profileById = new Map();
  currentSession = { user: { id: "user-1", role: "Reader" } };
  classroomProgressData = null;
});

test("job query helpers build Prisma filters and aggregate counts", async () => {
  const {
    countJobsByStatus,
    countJobsByType,
    getJob,
    listDeadLetterJobs,
    listJobs,
  } = await import("@/lib/jobs/queries");

  await listJobs({
    status: [JobStatus.PENDING, JobStatus.FAILED],
    type: JobType.ARTICLE_PROCESS,
    take: 7,
    skip: 3,
  });
  assert.deepEqual(jobFindManyArgs[0].where, {
    status: { in: [JobStatus.PENDING, JobStatus.FAILED] },
    type: JobType.ARTICLE_PROCESS,
  });
  assert.equal(jobFindManyArgs[0].take, 7);
  assert.equal(jobFindManyArgs[0].skip, 3);

  await listJobs({ status: JobStatus.COMPLETED, type: [JobType.AI_REBUILD, JobType.TTS_GENERATE] });
  assert.deepEqual(jobFindManyArgs[1].where, {
    status: JobStatus.COMPLETED,
    type: { in: [JobType.AI_REBUILD, JobType.TTS_GENERATE] },
  });

  await listDeadLetterJobs(4);
  assert.equal(jobFindManyArgs[2].where.status, JobStatus.DEAD_LETTER);
  assert.equal(jobFindManyArgs[2].take, 4);

  assert.equal(await getJob("job-1"), jobById);
  assert.deepEqual(jobFindUniqueArgs.at(-1), { where: { id: "job-1" } });
  assert.deepEqual(await countJobsByStatus(), { PENDING: 2, FAILED: 1 });
  assert.deepEqual(await countJobsByType(), { ARTICLE_PROCESS: 3 });
});

test("PostgreSQL job claiming handles empty queues and stale lock metrics", async () => {
  const { claimNextJobPostgres } = await import("@/lib/jobs/claim-postgres");
  const now = new Date("2026-01-01T12:00:00.000Z");

  queryRawRows = [];
  assert.equal(
    await claimNextJobPostgres("worker-a", now, new Date(now.getTime() - 60_000)),
    null,
  );
  assert.equal(queryRawCalls.length, 1);

  const lockedAt = new Date(now.getTime() - 30_000);
  queryRawRows = [{ id: "job-1", wasStale: true, lockedAt }];
  jobById = makeJob({ id: "job-1", type: JobType.TTS_GENERATE });
  const claimed = await claimNextJobPostgres(
    "worker-a",
    now,
    new Date(now.getTime() - 60_000),
    [JobType.TTS_GENERATE],
  );
  assert.equal(claimed?.id, "job-1");
  assert.deepEqual(metricCalls[0], ["lock-age", JobType.TTS_GENERATE, 30_000]);
  assert.deepEqual(metricCalls[1], [
    "queue-event",
    { event: "stale_reclaimed", type: JobType.TTS_GENERATE },
  ]);
});

test("admin job queries normalize filters and compute dashboard rows", async () => {
  const { getJobDashboard, listAdminJobs } = await import("@/lib/jobs/admin-queries");
  const now = new Date("2026-01-01T12:00:01.000Z");

  const result = await listAdminJobs({
    status: " failed ",
    type: "article_process",
    articleId: " article-1 ",
    failureReason: " timeout ",
    createdAfter: new Date("2025-12-31T00:00:00Z"),
    createdBefore: new Date("2026-01-02T00:00:00Z"),
    page: -5,
    pageSize: 200,
    now,
  });
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 100);
  assert.equal(result.status, JobStatus.FAILED);
  assert.equal(result.type, JobType.ARTICLE_PROCESS);
  assert.equal(result.jobs[0].articleId, "article-1");
  assert.equal(result.jobs[0].feature, "tags");
  assert.equal(result.jobs[0].lockAgeMs, 1_250);
  assert.equal(jobCountArgs[0].where.lastError.contains, "timeout");

  await listAdminJobs({ stuck: true, now });
  assert.deepEqual(jobCountArgs[1].where.status, { in: [JobStatus.CLAIMED, JobStatus.RUNNING] });
  assert.ok(jobCountArgs[1].where.lockedAt);

  const dashboard = await getJobDashboard({ now, recent: 2, lockTtlMs: 1_000 });
  assert.equal(dashboard.total, 3);
  assert.equal(dashboard.stuck, 1);
  assert.equal(dashboard.recentFailures.length, 1);
  assert.equal(dashboard.deadLetter.length, 1);
});

test("admin job actions include validation fallback for unknown actions", async () => {
  const { runJobAction } = await import("@/lib/jobs/admin-commands");
  const result = await runJobAction("job-1", "bogus" as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /Unknown action/);
  }
});

test("enqueue helpers and lifecycle edge branches cover dedupe races and admin archive", async () => {
  const enqueue = await import("@/lib/jobs/enqueue");
  const lifecycle = await import("@/lib/jobs/lifecycle");
  const now = new Date("2026-01-01T00:00:00.000Z");

  await enqueue.enqueueArticleIngest({ url: "https://example.test/a1" } as never);
  assert.equal(jobCreateArgs.at(-1)?.data.dedupeKey, "article-ingest:https://example.test/a1");
  await enqueue.enqueueArticleIngest({ source: "manual" } as never);
  assert.equal(jobCreateArgs.at(-1)?.data.dedupeKey, undefined);

  await enqueue.enqueueAiRebuild("article-1", { translateLangs: ["es"] });
  assert.equal(jobCreateArgs.at(-1)?.data.type, JobType.AI_REBUILD);
  assert.deepEqual(jobCreateArgs.at(-1)?.data.payload, { articleId: "article-1", translateLangs: ["es"] });

  await enqueue.enqueueTtsGenerate("article-1");
  assert.equal(jobCreateArgs.at(-1)?.data.type, JobType.TTS_GENERATE);
  assert.deepEqual(jobCreateArgs.at(-1)?.data.payload, { articleId: "article-1", tts: true });

  await enqueue.enqueuePushReminder({ userId: "user-1" } as never);
  assert.equal(jobCreateArgs.at(-1)?.data.type, JobType.PUSH_REMINDER);

  const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "test",
  });
  jobCreateError = p2002;
  dedupeWinner = makeJob({ id: "winner" });
  assert.equal(
    (await enqueue.enqueueJob(JobType.ARTICLE_PROCESS, { articleId: "a1" }, { dedupeKey: "race" })).id,
    "winner",
  );
  dedupeWinner = null;
  await assert.rejects(
    () => enqueue.enqueueJob(JobType.ARTICLE_PROCESS, { articleId: "a1" }, { dedupeKey: "race" }),
    /Unique constraint/,
  );
  jobCreateError = null;

  assert.equal((await lifecycle.startJob("job-1", "worker-a", { now }))?.status, JobStatus.RUNNING);
  assert.equal(jobUpdates.at(-1)?.data.startedAt, now);
  jobUpdateError = new Error("update failed");
  assert.equal(await lifecycle.startJob("job-1", "worker-a", { now }), null);
  jobUpdateError = null;

  jobById = null;
  assert.equal(await lifecycle.archiveJob("missing"), null);
  jobById = makeJob({ id: "job-archive", status: JobStatus.COMPLETED });
  assert.equal((await lifecycle.archiveJob("job-archive"))?.id, "job-archive");
  assert.deepEqual(jobDeletes.at(-1), { where: { id: "job-archive" } });
});

test("organization queries, slug generation, profiles, and guards use scoped lookups", async () => {
  const queries = await import("@/lib/org/queries");
  const guards = await import("@/lib/org/guards");
  const { CAPABILITIES } = await import("@/lib/rbac");
  const profile = await import("@/lib/profile/repository");
  const slugs = await import("@/lib/org/slugs");
  const commands = await import("@/lib/org/commands");

  assert.deepEqual(await queries.getOrganization("org-1"), { id: "org-1", slug: "readers" });
  assert.deepEqual(await queries.getOrganizationBySlug("readers"), { id: "org-1", slug: "readers" });
  membershipsByKey.set("user-1:org-1", { id: "m1", userId: "user-1", orgId: "org-1", role: "OrgAdmin" });
  assert.deepEqual(await commands.addMember("org-1", "user-2", "Member"), {
    id: "membership-upserted",
    orgId: "org-1",
    userId: "user-2",
    role: "Member",
  });
  assert.deepEqual(membershipUpserts[0], {
    where: { userId_orgId: { userId: "user-2", orgId: "org-1" } },
    update: { role: "Member" },
    create: { orgId: "org-1", userId: "user-2", role: "Member" },
  });
  assert.equal((await queries.getMembership("user-1", "org-1"))?.id, "m1");
  membershipFindManyRows = [{ id: "m1", org: { id: "org-1" } }];
  assert.equal((await queries.listUserOrganizations("user-1")).length, 1);
  assert.equal((await queries.listOrgMembers("org-1")).length, 1);

  assert.deepEqual(guards.orgCapabilities(null), []);
  assert.equal(guards.hasOrgCapability(null, CAPABILITIES.orgManage), false);
  assert.equal(guards.hasOrgCapability({ role: "OrgAdmin" }, CAPABILITIES.orgManage), true);
  assert.equal(guards.isSystemAdmin("Admin"), true);
  assert.equal(guards.isSystemAdmin("OrgAdmin"), false);

  currentSession = { user: { id: "admin-1", role: "Admin" } };
  let orgSession = await guards.requireOrgMembership("org-1", "/orgs/org-1");
  assert.equal(orgSession.session.user.id, "admin-1");
  assert.equal(orgSession.membership, null);

  currentSession = { user: { id: "user-1", role: "Reader" } };
  orgSession = await guards.requireOrgMembership("org-1", "/orgs/org-1");
  assert.equal(orgSession.membership?.id, "m1");
  orgSession = await guards.requireOrgCapability("org-1", CAPABILITIES.orgManage, "/orgs/org-1");
  assert.equal(orgSession.membership?.id, "m1");
  currentSession = { user: { id: "admin-1", role: "Admin" } };
  orgSession = await guards.requireOrgCapability("org-1", CAPABILITIES.orgManage, "/orgs/org-1");
  assert.equal(orgSession.membership, null);
  await guards.requireOrgAdmin("org-1", "/orgs/org-1");

  currentSession = { user: { id: "user-1", role: "Reader" } };
  membershipsByKey.set("user-1:org-1", null);
  await assert.rejects(() => guards.requireOrgMembership("org-1", "/orgs/org-1"), /redirect:\/forbidden/);
  await assert.rejects(
    () => guards.requireOrgCapability("org-1", CAPABILITIES.orgManage, "/orgs/org-1"),
    /redirect:\/forbidden/,
  );

  profileById.set("user-1", { userId: "user-1", completedAt: new Date() });
  assert.equal(await profile.getProfile("user-1"), profileById.get("user-1"));
  assert.equal(profile.isOnboarded(null), false);
  assert.equal(profile.isOnboarded({ completedAt: new Date() } as never), true);
  assert.equal(await profile.isUserOnboarded("user-1"), true);

  assert.equal(slugs.slugifyOrg(" Les élèves & Teachers! "), "les-eleves-and-teachers");
  organizationsBySlug.set("readers-2", { id: "org-2", slug: "readers-2" });
  assert.equal(await slugs.ensureUniqueOrgSlug("readers"), "readers-3");
  assert.equal(await slugs.ensureUniqueOrgSlug(""), "org");
  for (let i = 0; i < 1000; i++) {
    organizationsBySlug.set(i === 0 ? "taken" : `taken-${i + 1}`, { id: `taken-${i}` });
  }
  assert.match(await slugs.ensureUniqueOrgSlug("taken"), /^taken-\d+$/);
});

test("analytics range parsing and repository loaders handle segments and bounds", async () => {
  const range = await import("@/lib/analytics/queries/range");
  const repo = await import("@/lib/analytics/queries/repository");
  const retention = await import("@/lib/analytics/queries/retention");

  const now = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(range.resolveTimeRange(undefined, now).days, 30);
  assert.equal(range.resolveTimeRange(0, now).days, 30);
  assert.equal(range.resolveTimeRange(500, now).days, 365);
  assert.equal(range.resolveTimeRange(7.9, now).days, 7);
  assert.deepEqual(range.parseAnalyticsQuery({ days: "999", level: " B1 ", topic: " science " }), {
    days: 365,
    segment: { level: "B1", topic: "science" },
  });
  assert.deepEqual(range.parseAnalyticsQuery({ days: "nope" }), { days: 30, segment: undefined });

  let groupByArgs: AnyArgs | null = null;
  let findManyArgs: AnyArgs | null = null;
  const client = {
    analyticsEvent: {
      groupBy: async (args: AnyArgs) => {
        groupByArgs = args;
        return [
          { type: "progress.complete", userId: "u1", _count: { _all: 2 } },
          { type: "progress.complete", userId: "u2", _count: { _all: 1 } },
        ];
      },
      findMany: async (args: AnyArgs) => {
        findManyArgs = args;
        return [{ userId: "u1", occurredAt: now }];
      },
    },
  };

  const emptyOverview = await repo.getAnalyticsOverview({
    segment: { level: "C2", topic: null },
    resolveSegment: async () => [],
    client: client as never,
  });
  assert.equal(emptyOverview.segmentUserCount, 0);
  assert.equal(groupByArgs, null);

  const overview = await repo.getAnalyticsOverview({
    since: new Date("2026-01-01T00:00:00Z"),
    until: now,
    segment: { level: "B1", topic: null },
    resolveSegment: async () => ["u1"],
    client: client as never,
  });
  assert.equal(overview.segmentUserCount, 1);
  assert.deepEqual((groupByArgs as AnyArgs | null)?.where, {
    occurredAt: { gte: new Date("2026-01-01T00:00:00Z"), lt: now },
    userId: { in: ["u1"] },
  });

  const emptyCohorts = await repo.getRetentionCohorts({
    now,
    weeks: 3,
    segment: { level: "C2", topic: null },
    resolveSegment: async () => [],
    client: client as never,
  });
  assert.equal(emptyCohorts.length, 3);

  await repo.getRetentionCohorts({
    now,
    weeks: 100,
    segment: { level: "B1", topic: null },
    resolveSegment: async () => ["u1"],
    client: client as never,
  });
  assert.deepEqual((findManyArgs as AnyArgs | null)?.where.userId, { in: ["u1"] });
  assert.ok((findManyArgs as AnyArgs | null)?.where.occurredAt);

  const cohorts = retention.computeRetentionCohorts(
    [
      { userId: null, occurredAt: now },
      { userId: "old", occurredAt: new Date("2025-01-01T00:00:00Z") },
      { userId: "future", occurredAt: new Date("2026-03-01T00:00:00Z") },
      { userId: "active", occurredAt: now },
    ],
    { now, weeks: 2 },
  );
  assert.equal(cohorts.at(-1)?.size, 1);
});

test("tenant analytics aggregates classroom data and applies role redaction", async () => {
  const tenant = await import("@/lib/analytics/tenant");

  assert.deepEqual(tenant.analyticsAccessFor("systemAdmin"), { scope: "global", individualData: true });
  assert.deepEqual(tenant.analyticsAccessFor("orgAdmin"), { scope: "org", individualData: false });
  assert.deepEqual(tenant.analyticsAccessFor("teacher"), { scope: "classroom", individualData: true });
  assert.deepEqual(tenant.analyticsAccessFor("learner"), { scope: "self", individualData: false });

  assert.deepEqual(
    tenant.learnerDataAccess({
      viewerRole: "teacher",
      sameUser: false,
      targetInViewerClassroom: true,
      targetInViewerOrg: false,
    }),
    { allowed: true, individual: true },
  );
  assert.deepEqual(
    tenant.learnerDataAccess({
      viewerRole: "orgAdmin",
      sameUser: false,
      targetInViewerClassroom: false,
      targetInViewerOrg: true,
    }),
    { allowed: true, individual: false },
  );
  assert.deepEqual(
    tenant.learnerDataAccess({
      viewerRole: "learner",
      sameUser: false,
      targetInViewerClassroom: true,
      targetInViewerOrg: true,
    }),
    { allowed: false, individual: false },
  );

  classroomProgressData = {
    classroom: { id: "class-1", name: "Class One" },
    students: [
      { userId: "student-1", name: "Student One", email: null },
      { userId: "student-2", name: null, email: null },
    ],
    assignments: [
      { id: "assignment-1", articleTitle: "Article One" },
      { id: "assignment-2", articleTitle: "Article Two" },
    ],
    completions: [
      {
        assignmentId: "assignment-1",
        studentId: "student-1",
        status: AssignmentStatus.COMPLETED,
        quizScore: 80,
      },
      {
        assignmentId: "assignment-1",
        studentId: "student-2",
        status: AssignmentStatus.IN_PROGRESS,
        quizScore: null,
      },
      {
        assignmentId: "assignment-2",
        studentId: "student-1",
        status: AssignmentStatus.COMPLETED,
        quizScore: 100,
      },
      {
        assignmentId: "assignment-2",
        studentId: "outside-student",
        status: AssignmentStatus.COMPLETED,
        quizScore: 100,
      },
    ],
  };

  const aggregate = tenant.aggregateClassroom(classroomProgressData as never);
  assert.equal(aggregate.studentCount, 2);
  assert.equal(aggregate.assignmentCount, 2);
  assert.equal(aggregate.totalExpected, 4);
  assert.equal(aggregate.totalCompleted, 2);
  assert.equal(aggregate.averageQuizScore, 90);
  assert.equal(aggregate.perAssignment[0].inProgress, 1);
  assert.equal(aggregate.perAssignment[1].notStarted, 1);
  assert.equal(aggregate.perStudent[0].completionRate, 100);

  const redacted = tenant.redactIndividualData(aggregate);
  assert.equal(redacted.redacted, true);
  assert.deepEqual(redacted.perStudent, []);
  assert.equal(tenant.redactIndividualData(redacted), redacted);
  assert.equal(tenant.applyAnalyticsAccess(aggregate, { scope: "org", individualData: false }).redacted, true);
  assert.equal(tenant.applyAnalyticsAccess(aggregate, { scope: "classroom", individualData: true }).redacted, false);

  assert.equal(
    tenant.viewerRoleForClassroom({
      viewer: { id: "admin-1", role: "Admin" },
      classroom: { teacherId: "teacher-1", orgId: "org-1" },
      isOrgAdmin: false,
    }),
    "systemAdmin",
  );
  assert.equal(
    tenant.viewerRoleForClassroom({
      viewer: { id: "teacher-1", role: "Reader" },
      classroom: { teacherId: "teacher-1", orgId: "org-1" },
      isOrgAdmin: false,
    }),
    "teacher",
  );
  assert.equal(
    tenant.viewerRoleForClassroom({
      viewer: { id: "org-admin", role: "Reader" },
      classroom: { teacherId: "teacher-1", orgId: "org-1" },
      isOrgAdmin: true,
    }),
    "orgAdmin",
  );
  assert.equal(
    tenant.viewerRoleForClassroom({
      viewer: { id: "student-1", role: "Reader" },
      classroom: { teacherId: "teacher-1", orgId: "org-1" },
      isOrgAdmin: false,
    }),
    "learner",
  );

  const savedClassroomProgressData = classroomProgressData;
  classroomProgressData = null;
  assert.equal(await tenant.getClassroomAnalytics("missing", "teacher"), null);
  classroomProgressData = savedClassroomProgressData;
  const classroomAnalytics = await tenant.getClassroomAnalytics("class-1", "orgAdmin");
  assert.equal(classroomAnalytics?.redacted, true);
  assert.deepEqual(classroomAnalytics?.perStudent, []);
});
