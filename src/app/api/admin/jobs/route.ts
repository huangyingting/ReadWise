import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
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

function jobsAdminQuery(params: URLSearchParams) {
  const readFilter = (name: string) => {
    const value = queryString(params, name).trim();
    return value ? value.slice(0, 200) : null;
  };
  const rawStuck = queryString(params, "stuck");
  return {
    ok: true as const,
    value: {
      status: readFilter("status"),
      type: readFilter("type"),
      articleId: readFilter("articleId"),
      failureReason: readFilter("reason"),
      stuck: rawStuck === "1" || rawStuck === "true",
      page: queryInt(params, "page", { fallback: 1, min: 1, max: 10_000 }),
    },
  };
}

export const GET = createAdminHandler(
  { query: jobsAdminQuery },
  async ({ query }) => {
    const [result, dashboard] = await Promise.all([
      listAdminJobs(query),
      getJobDashboard(),
    ]);
    return NextResponse.json({ ...result, dashboard });
  },
);
