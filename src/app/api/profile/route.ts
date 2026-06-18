import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSessionApi } from "@/lib/api-auth";
import { parseProfileInput } from "@/lib/profile";

type ProfilePayload = {
  ageRange?: unknown;
  gender?: unknown;
  englishLevel?: unknown;
  topics?: unknown;
};

export async function PUT(req: Request) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  let body: ProfilePayload;
  try {
    body = (await req.json()) as ProfilePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseProfileInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const data = {
    ageRange: parsed.value.ageRange,
    gender: parsed.value.gender,
    englishLevel: parsed.value.englishLevel,
    topics: JSON.stringify(parsed.value.topics),
  };

  await prisma.profile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data, completedAt: new Date() },
    update: data,
  });

  return NextResponse.json({ ok: true });
}
