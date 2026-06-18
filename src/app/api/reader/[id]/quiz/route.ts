import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { getOrCreateArticleQuiz } from "@/lib/quiz";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireSessionApi();
  if (error) {
    return error;
  }

  const { id } = await params;

  const result = await getOrCreateArticleQuiz(id);
  if (!result) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
