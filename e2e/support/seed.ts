import type { BrowserContext } from "@playwright/test";

import { prisma } from "@/lib/prisma";
import {
  resetE2eDatabase,
  seedE2eArticles,
  seedE2eMember,
} from "@/lib/testing/e2e-fixtures";

export {
  TEST_ARTICLE_ID,
  TEST_MEMBER_ID,
  createUserWithSession,
  createSessionForUser,
  seedDueFlashcard,
  seedTeacherClassroom,
} from "@/lib/testing/e2e-fixtures";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const SESSION_COOKIE_NAME = "next-auth.session-token";
const MS_PER_SECOND = 1000;

export async function seedSmokeData(): Promise<void> {
  await resetE2eDatabase();
  await seedE2eArticles();
  await seedE2eMember();
}

export async function addSessionCookie(
  context: BrowserContext,
  sessionToken: string,
  expires: Date,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(expires.getTime() / MS_PER_SECOND),
    },
  ]);
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
