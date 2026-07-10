import { JobStatus, JobType } from "@prisma/client";
import { recordJobQueueDepth } from "@/lib/metrics";
import { countJobsByTypeAndStatus } from "./queries";

function queueDepthKey(type: JobType, status: JobStatus): string {
  return `${type}:${status}`;
}

/**
 * Refreshes current queue-depth gauges from the durable Job table.
 * All known type/status combinations are emitted so previously non-zero series
 * return to zero when a backlog drains.
 */
export async function refreshJobQueueDepthMetrics(): Promise<void> {
  const counts = await countJobsByTypeAndStatus();
  const byTypeStatus = new Map(
    counts.map((row) => [queueDepthKey(row.type, row.status), row.count]),
  );

  for (const type of Object.values(JobType)) {
    for (const status of Object.values(JobStatus)) {
      recordJobQueueDepth({
        type,
        status,
        depth: byTypeStatus.get(queueDepthKey(type, status)) ?? 0,
      });
    }
  }
}
