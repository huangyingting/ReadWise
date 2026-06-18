import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { lookupWord } from "@/lib/dictionary";

export async function POST(req: Request) {
  const { error } = await requireSessionApi();
  if (error) {
    return error;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const word =
    body && typeof body === "object" && "word" in body
      ? String((body as { word: unknown }).word ?? "")
      : "";

  if (!word.trim()) {
    return NextResponse.json({ error: "Missing word" }, { status: 400 });
  }

  const result = await lookupWord(word);
  return NextResponse.json(result);
}
