import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { unsaveWord } from "@/lib/vocabulary";

type UnsavePayload = {
  word?: unknown;
};

export async function POST(req: Request) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  let body: UnsavePayload;
  try {
    body = (await req.json()) as UnsavePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!word) {
    return NextResponse.json({ error: "Word is required" }, { status: 400 });
  }

  await unsaveWord(session.user.id, word);

  return NextResponse.json({ word, saved: false });
}
