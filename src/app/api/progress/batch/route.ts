import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { getProgressSummaries } from "@/lib/progress";

type BatchPayload = {
  ids?: unknown;
};

/** Cap to keep a single batch request bounded. */
const MAX_IDS = 200;

/**
 * Returns reading progress for a set of article ids in a single request so
 * listings can merge progress without issuing one request per card (no N+1).
 * Body: `{ ids: string[] }` -> `{ progress: Record<id, {percent, completed}> }`.
 */
export async function POST(req: Request) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  let body: BatchPayload;
  try {
    body = (await req.json()) as BatchPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  const ids = Array.from(
    new Set(
      body.ids.filter((id): id is string => typeof id === "string" && id !== ""),
    ),
  ).slice(0, MAX_IDS);

  const progress = await getProgressSummaries(session.user.id, ids);

  return NextResponse.json({ progress });
}
