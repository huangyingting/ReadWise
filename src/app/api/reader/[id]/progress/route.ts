import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSessionApi } from "@/lib/api-auth";
import { saveProgress } from "@/lib/progress";

type ProgressPayload = {
  percent?: unknown;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  const { id } = await params;

  let body: ProgressPayload;
  try {
    body = (await req.json()) as ProgressPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const percent = Number(body.percent);
  if (!Number.isFinite(percent)) {
    return NextResponse.json({ error: "Invalid percent" }, { status: 400 });
  }

  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const progress = await saveProgress(session.user.id, article.id, percent);

  return NextResponse.json({
    percent: progress.percent,
    completed: progress.completed,
  });
}
