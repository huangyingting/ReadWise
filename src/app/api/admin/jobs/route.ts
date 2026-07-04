import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import { listAdminJobs, getJobDashboard } from "@/lib/admin/jobs";

type JobsAdminQuery = {
  status: string | null;
  type: string | null;
  articleId: string | null;
  failureReason: string | null;
  stuck: boolean;
  page: number;
};

function readJobFilter(params: URLSearchParams, name: string): string | null {
  const value = queryString(params, name).trim();
  return value ? value.slice(0, 200) : null;
}

function parseStuckFilter(params: URLSearchParams): boolean {
  const value = queryString(params, "stuck");
  return value === "1" || value === "true";
}

function jobsAdminQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      status: readJobFilter(params, "status"),
      type: readJobFilter(params, "type"),
      articleId: readJobFilter(params, "articleId"),
      failureReason: readJobFilter(params, "reason"),
      stuck: parseStuckFilter(params),
      page: queryInt(params, "page", { fallback: 1, min: 1, max: 10_000 }),
    },
  };
}

async function getAdminJobsPayload(query: JobsAdminQuery) {
  const [result, dashboard] = await Promise.all([
    listAdminJobs(query),
    getJobDashboard(),
  ]);
  return { ...result, dashboard };
}

export const GET = createCapabilityHandler(
  CAPABILITIES.jobsManage,
  { query: jobsAdminQuery },
  async ({ query }) => {
    return NextResponse.json(await getAdminJobsPayload(query));
  },
);
