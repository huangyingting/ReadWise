import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  addSessionCookie,
  createUserWithSession,
  disconnectDb,
  seedSmokeData,
  TEST_ARTICLE_ID,
} from "./seed";

export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const ARTICLE_HEADING = "E2E Critical Reading Smoke Article";

type SignInOptions = Parameters<typeof createUserWithSession>[0];
type SignInResult = Awaited<ReturnType<typeof createUserWithSession>>;
type SignIn = (options?: SignInOptions) => Promise<SignInResult>;

type ReadwiseFixtures = {
  seededDb: void;
  signIn: SignIn;
  readerSession: SignInResult;
  adminSession: SignInResult;
  readerPage: Page;
  adminPage: Page;
  mobilePage: Page;
};

type ReadwiseWorkerFixtures = {
  dbConnection: void;
};

async function signInContext(
  context: BrowserContext,
  options: SignInOptions = {},
): Promise<SignInResult> {
  const session = await createUserWithSession(options);
  await addSessionCookie(context, session.sessionToken, session.expires);
  return session;
}

export const test = base.extend<ReadwiseFixtures, ReadwiseWorkerFixtures>({
  dbConnection: [
    async ({}, runFixture) => {
      await runFixture();
      await disconnectDb();
    },
    { scope: "worker", auto: true },
  ],

  seededDb: [
    async ({ context }, runFixture) => {
      await context.clearCookies();
      await seedSmokeData();
      await runFixture();
    },
    { auto: true },
  ],

  signIn: async ({ context, seededDb }, runFixture) => {
    void seededDb;
    await runFixture((options) => signInContext(context, options));
  },

  readerSession: async ({ signIn }, runFixture) => {
    await runFixture(await signIn({ role: "Reader" }));
  },

  adminSession: async ({ signIn }, runFixture) => {
    await runFixture(await signIn({ role: "Admin" }));
  },

  readerPage: async ({ page, readerSession }, runFixture) => {
    void readerSession;
    await runFixture(page);
  },

  adminPage: async ({ page, adminSession }, runFixture) => {
    void adminSession;
    await runFixture(page);
  },

  mobilePage: async ({ page }, runFixture) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await runFixture(page);
  },
});

export { expect, TEST_ARTICLE_ID };
