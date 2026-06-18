import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { saveWord } from "@/lib/vocabulary";

type SavePayload = {
  word?: unknown;
  explanation?: unknown;
  example?: unknown;
  articleId?: unknown;
};

export async function POST(req: Request) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  let body: SavePayload;
  try {
    body = (await req.json()) as SavePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!word) {
    return NextResponse.json({ error: "Word is required" }, { status: 400 });
  }

  await saveWord(session.user.id, {
    word,
    explanation: typeof body.explanation === "string" ? body.explanation : null,
    example: typeof body.example === "string" ? body.example : null,
    articleId: typeof body.articleId === "string" ? body.articleId : null,
  });

  return NextResponse.json({ word, saved: true });
}
