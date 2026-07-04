/**
 * Read-side query helpers for the job queue: listing, filtering, and aggregate
 * counts for dashboards and admin views.
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, type Job } from "@prisma/client";
import type { JobType } from "@prisma/client";

export type ListJobsFilter = {
  status?: JobStatus | JobStatus[];
  type?: JobType | JobType[];
  take?: number;
  skip?: number;
};

function scalarOrIn<T>(value: T | T[] | undefined): T | { in: T[] } | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? { in: value } : value;
}

function listJobsWhere(filter: ListJobsFilter): Prisma.JobWhereInput {
  return {
    ...(filter.status ? { status: scalarOrIn(filter.status) } : {}),
    ...(filter.type ? { type: scalarOrIn(filter.type) } : {}),
  };
}

function groupCounts<T extends string>(
  groups: Array<{ [K in T]: string } & { _count: { _all: number } }>,
  key: T,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of groups) {
    out[group[key]] = group._count._all;
  }
  return out;
}

export function listJobs(filter: ListJobsFilter = {}): Promise<Job[]> {
  return prisma.job.findMany({
    where: listJobsWhere(filter),
    orderBy: [{ createdAt: "desc" }],
    take: filter.take ?? 100,
    skip: filter.skip ?? 0,
  });
}

export function listDeadLetterJobs(take = 100): Promise<Job[]> {
  return listJobs({ status: JobStatus.DEAD_LETTER, take });
}

export function getJob(jobId: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id: jobId } });
}

/** Returns a `{ status: count }` map for dashboards/monitoring. */
export async function countJobsByStatus(): Promise<Record<string, number>> {
  const groups = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  return groupCounts(groups, "status");
}

/** Returns a `{ type: count }` map for dashboards/monitoring. */
export async function countJobsByType(): Promise<Record<string, number>> {
  const groups = await prisma.job.groupBy({ by: ["type"], _count: { _all: true } });
  return groupCounts(groups, "type");
}

export type JobQueueDepthCount = {
  type: JobType;
  status: JobStatus;
  count: number;
};

/** Returns current job counts grouped by low-cardinality type/status labels. */
export async function countJobsByTypeAndStatus(): Promise<JobQueueDepthCount[]> {
  const groups = await prisma.job.groupBy({ by: ["type", "status"], _count: { _all: true } });
  return groups.map((group) => ({
    type: group.type,
    status: group.status,
    count: group._count._all,
  }));
}
