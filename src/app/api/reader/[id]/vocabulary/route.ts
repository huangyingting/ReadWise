import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  const { id } = await params;

  const result = await getOrCreateArticleVocabulary(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
