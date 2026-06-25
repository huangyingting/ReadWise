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

export function listJobs(filter: ListJobsFilter = {}): Promise<Job[]> {
  const where: Prisma.JobWhereInput = {};
  if (filter.status) where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
  if (filter.type) where.type = Array.isArray(filter.type) ? { in: filter.type } : filter.type;
  return prisma.job.findMany({
    where,
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
  const out: Record<string, number> = {};
  for (const g of groups) {
    out[g.status] = g._count._all;
  }
  return out;
}

/** Returns a `{ type: count }` map for dashboards/monitoring. */
export async function countJobsByType(): Promise<Record<string, number>> {
  const groups = await prisma.job.groupBy({ by: ["type"], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const g of groups) {
    out[g.type] = g._count._all;
  }
  return out;
}
