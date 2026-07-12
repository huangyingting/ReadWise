/**
 * Shared Playwright UI audit matrix and runner.
 *
 * Matrix: 50 route/session profiles × 5 behavior intents × 2 presentations.
 * Tests are intentionally data-driven so `--list` proves the registered count,
 * while normal Playwright `--grep` / `--shard` can run practical partitions.
 */
import { type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, TEST_ARTICLE_ID, TEST_MEMBER_ID } from "./fixtures";

export type SessionState = "anonymous" | "reader" | "admin" | "new-reader";
export type SignIn = (options?: {
  role?: "Admin" | "Reader";
  onboarded?: boolean;
}) => Promise<unknown>;
export type Subsystem =
  | "admin"
  | "auth"
  | "browse"
  | "dashboard"
  | "import"
  | "legal"
  | "lists"
  | "marketing"
  | "notes"
  | "offline"
  | "onboarding"
  | "progress"
  | "reader"
  | "series"
  | "settings"
  | "study"
  | "tags"
  | "teacher"
  | "today";

export type RouteProfile = {
  id: string;
  subsystem: Subsystem;
  session: SessionState;
  path: string;
  expectedPathname?: string;
  heading: string | RegExp;
  expectedText?: string | RegExp;
  tags?: string[];
};

export type Intent = {
  id: string;
  title: string;
};

export type Presentation = {
  id: string;
  title: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
};

export type Scenario = {
  caseId: string;
  route: RouteProfile;
  intent: Intent;
  presentation: Presentation;
};

type AuditLogs = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  serverResponses: string[];
};

const ARTIFACT_DIR = path.resolve(
  process.env.UI_AUDIT_ARTIFACT_DIR ?? path.join("test-results", "ui-audit"),
);
const CATALOG_PATH = path.join(ARTIFACT_DIR, "catalog.json");
const RUN_ID =
  process.env.UI_AUDIT_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const RESULTS_PATH = path.join(ARTIFACT_DIR, `results-${RUN_ID}.jsonl`);
const LATEST_RUN_PATH = path.join(ARTIFACT_DIR, "latest-run.json");
const MAX_LOG_LENGTH = 1_000;
const THEME_STORAGE_KEY = "readwise:theme";
const FATAL_PATTERNS = [
  /Hydration failed/i,
  /There was an error while hydrating/i,
  /Text content does not match server-rendered HTML/i,
  /Expected server HTML/i,
  /Minified React error/i,
  /Element type is invalid/i,
  /cannot contain a nested/i,
  /cannot be a descendant of <p>/i,
  /<p> cannot contain/i,
  /Cannot read properties of (undefined|null)/i,
  /Unhandled Runtime Error/i,
  /ChunkLoadError/i,
  /The above error occurred in/i,
];

export const PRESENTATIONS: Presentation[] = [
  {
    id: "desktop-light",
    title: "desktop viewport with light theme",
    viewport: { width: 1440, height: 900 },
    theme: "light",
  },
  {
    id: "mobile-dark",
    title: "mobile viewport with dark theme",
    viewport: { width: 390, height: 844 },
    theme: "dark",
  },
];

export const INTENTS: Intent[] = [
  { id: "render", title: "rendering the page or redirect target" },
  { id: "semantic-smoke", title: "checking headings and page landmarks" },
  { id: "keyboard-focus", title: "checking keyboard focus reaches UI" },
  { id: "route-behavior", title: "exercising a route-specific user behavior" },
  { id: "theme-overflow", title: "checking theme application and viewport overflow" },
];

export const PUBLIC_AUTH_ONBOARDING_ROUTES: RouteProfile[] = [

  {
    id: "marketing-home-anon",
    subsystem: "marketing",
    session: "anonymous",
    path: "/",
    heading: "Real news. Real English. Real progress.",
    expectedText: "AI-Powered English Learning",
  },

  {
    id: "signin-anon",
    subsystem: "auth",
    session: "anonymous",
    path: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "signin-error-anon",
    subsystem: "auth",
    session: "anonymous",
    path: "/signin?error=OAuthSignin",
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: /problem|unable|try again/i,
  },

  {
    id: "marketing-home-reader",
    subsystem: "marketing",
    session: "reader",
    path: "/",
    heading: "Real news. Real English. Real progress.",
    expectedText: /Continue Reading/i,
  },

  {
    id: "auth-redirect-dashboard",
    subsystem: "auth",
    session: "anonymous",
    path: "/dashboard",
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "auth-redirect-browse",
    subsystem: "auth",
    session: "anonymous",
    path: "/browse",
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "auth-redirect-reader",
    subsystem: "auth",
    session: "anonymous",
    path: `/reader/${TEST_ARTICLE_ID}`,
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "auth-redirect-study",
    subsystem: "auth",
    session: "anonymous",
    path: "/study",
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "auth-redirect-teacher",
    subsystem: "auth",
    session: "anonymous",
    path: "/teacher",
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "auth-redirect-assignments",
    subsystem: "auth",
    session: "anonymous",
    path: "/assignments",
    expectedPathname: "/signin",
    heading: "Sign in to ReadWise",
    expectedText: "Back to home",
  },

  {
    id: "onboarding-new-reader",
    subsystem: "onboarding",
    session: "new-reader",
    path: "/onboarding",
    heading: "Welcome to ReadWise",
    expectedText: "Your English level",
  },

  {
    id: "dashboard-new-reader-redirect",
    subsystem: "onboarding",
    session: "new-reader",
    path: "/dashboard",
    expectedPathname: "/onboarding",
    heading: "Welcome to ReadWise",
    expectedText: "Your English level",
  },

  {
    id: "welcome-reader",
    subsystem: "onboarding",
    session: "reader",
    path: "/welcome",
    heading: "Welcome to ReadWise",
    expectedText: /placement|start|skip/i,
  },

  {
    id: "privacy-public",
    subsystem: "legal",
    session: "anonymous",
    path: "/privacy",
    heading: "Privacy Policy",
    expectedText: /localStorage|signed-in state/i,
  },

  {
    id: "terms-public",
    subsystem: "legal",
    session: "anonymous",
    path: "/terms",
    heading: "Terms of Service",
    expectedText: /do not agree|Service/i,
  },

];
export const READER_LEARNING_ROUTES: RouteProfile[] = [

  {
    id: "dashboard-reader",
    subsystem: "dashboard",
    session: "reader",
    path: "/dashboard",
    heading: "Dashboard",
    expectedText: "For You",
  },

  {
    id: "dashboard-reader-level-filter",
    subsystem: "dashboard",
    session: "reader",
    path: "/dashboard?level=B1",
    expectedPathname: "/dashboard",
    heading: "Dashboard",
    expectedText: /E2E Critical Reading/i,
  },

  {
    id: "browse-reader-all",
    subsystem: "browse",
    session: "reader",
    path: "/browse",
    heading: "Browse",
    expectedText: "All categories",
  },

  {
    id: "browse-reader-tech",
    subsystem: "browse",
    session: "reader",
    path: "/browse?category=tech",
    expectedPathname: "/browse",
    heading: "Browse",
    expectedText: /E2E Critical Reading/i,
  },

  {
    id: "browse-reader-picks",
    subsystem: "browse",
    session: "reader",
    path: "/browse?view=picks",
    expectedPathname: "/browse",
    heading: "Browse",
    expectedText: /E2E .*Practice|E2E Critical Reading/i,
  },

  {
    id: "reader-article-controls",
    subsystem: "reader",
    session: "reader",
    path: `/reader/${TEST_ARTICLE_ID}`,
    heading: "E2E Critical Reading Smoke Article",
    expectedText: "Practice tools",
    tags: ["@high-risk"],
  },

  {
    id: "reader-article-practice-tools",
    subsystem: "reader",
    session: "reader",
    path: `/reader/${TEST_ARTICLE_ID}`,
    heading: "E2E Critical Reading Smoke Article",
    expectedText: "Practice tools",
    tags: ["@high-risk"],
  },

  {
    id: "today-reader-plan",
    subsystem: "today",
    session: "reader",
    path: "/today",
    heading: "Today",
    expectedText: "Today's steps",
    tags: ["@high-risk"],
  },

  {
    id: "today-reader-skip",
    subsystem: "today",
    session: "reader",
    path: "/today",
    heading: "Today",
    expectedText: "Skip today",
    tags: ["@high-risk"],
  },

  {
    id: "study-reader",
    subsystem: "study",
    session: "reader",
    path: "/study",
    heading: "Study list",
    expectedText: /Vocabulary|quiz/i,
  },

  {
    id: "study-words-reader",
    subsystem: "study",
    session: "reader",
    path: "/study/words",
    heading: "Vocabulary journal",
    expectedText: "Back to Study hub",
  },

  {
    id: "offline-reader",
    subsystem: "offline",
    session: "reader",
    path: "/offline",
    heading: "Offline Library",
    expectedText: /No articles saved offline yet|Articles saved here/i,
    tags: ["@pwa"],
  },

  {
    id: "notes-reader-empty",
    subsystem: "notes",
    session: "reader",
    path: "/notes",
    heading: "Notes & Highlights",
    expectedText: "No highlights yet",
  },

  {
    id: "progress-reader-empty",
    subsystem: "progress",
    session: "reader",
    path: "/progress",
    heading: "My Progress",
    expectedText: /No reading activity|No quiz attempts/i,
  },

  {
    id: "lists-reader-empty",
    subsystem: "lists",
    session: "reader",
    path: "/lists",
    heading: "Saved",
    expectedText: "No saved articles yet",
  },

  {
    id: "tags-reader-index",
    subsystem: "tags",
    session: "reader",
    path: "/tags",
    heading: "Tags",
    expectedText: "Technology",
  },

  {
    id: "tags-reader-tech-detail",
    subsystem: "tags",
    session: "reader",
    path: "/tags/tech",
    heading: "#Technology",
    expectedText: /E2E Critical Reading/i,
  },

  {
    id: "import-reader",
    subsystem: "import",
    session: "reader",
    path: "/import",
    heading: "Import Article",
    expectedText: /Save any article|Paste your article text/i,
  },

  {
    id: "settings-reader",
    subsystem: "settings",
    session: "reader",
    path: "/settings",
    heading: "Settings",
    expectedText: "App theme",
  },

  {
    id: "series-reader-empty",
    subsystem: "series",
    session: "reader",
    path: "/series",
    heading: "Reading series",
    expectedText: /No reading series are available/i,
  },

];
export const CLASSROOM_ROUTES: RouteProfile[] = [

  {
    id: "assignments-reader-empty",
    subsystem: "teacher",
    session: "reader",
    path: "/assignments",
    heading: "Assignments",
    expectedText: "No assignments yet",
  },

  {
    id: "teacher-reader-empty",
    subsystem: "teacher",
    session: "reader",
    path: "/teacher",
    heading: "Teaching",
    expectedText: "No classrooms yet",
  },

];
export const ADMIN_OPERATIONS_ROUTES: RouteProfile[] = [

  {
    id: "admin-dashboard",
    subsystem: "admin",
    session: "admin",
    path: "/admin",
    heading: "Dashboard",
    expectedText: "Overview",
  },

  {
    id: "admin-articles",
    subsystem: "admin",
    session: "admin",
    path: "/admin/articles",
    heading: "Articles",
    expectedText: /E2E Critical Reading/i,
  },

  {
    id: "admin-articles-filtered",
    subsystem: "admin",
    session: "admin",
    path: "/admin/articles?status=PUBLISHED&q=E2E",
    expectedPathname: "/admin/articles",
    heading: "Articles",
    expectedText: /E2E Critical Reading/i,
  },

  {
    id: "admin-article-detail",
    subsystem: "admin",
    session: "admin",
    path: `/admin/articles/${TEST_ARTICLE_ID}`,
    heading: "E2E Critical Reading Smoke Article",
    expectedText: /Correct metadata|Review verdict|Quality/i,
    tags: ["@high-risk"],
  },

  {
    id: "admin-jobs",
    subsystem: "admin",
    session: "admin",
    path: "/admin/jobs",
    heading: "Jobs",
    expectedText: /Filter|No jobs/i,
  },

  {
    id: "admin-jobs-filtered",
    subsystem: "admin",
    session: "admin",
    path: "/admin/jobs?status=queued",
    expectedPathname: "/admin/jobs",
    heading: "Jobs",
    expectedText: /Filter/i,
  },

  {
    id: "admin-members",
    subsystem: "admin",
    session: "admin",
    path: "/admin/members",
    heading: "Members",
    expectedText: /Search name or email|E2E Admin/i,
  },

  {
    id: "admin-member-detail",
    subsystem: "admin",
    session: "admin",
    path: `/admin/members/${TEST_MEMBER_ID}`,
    heading: "Member support",
    expectedText: "Activity summary",
    tags: ["@high-risk"],
  },

  {
    id: "admin-reports",
    subsystem: "admin",
    session: "admin",
    path: "/admin/reports",
    heading: "Content Reports",
    expectedText: /No reports found|Filter by status/i,
  },

  {
    id: "admin-tags",
    subsystem: "admin",
    session: "admin",
    path: "/admin/tags",
    heading: "Global tags",
    expectedText: /Search tag name|Technology/i,
  },

  {
    id: "admin-sources",
    subsystem: "admin",
    session: "admin",
    path: "/admin/sources",
    heading: "Content sources",
    expectedText: /Sync from registry|No content sources yet/i,
  },

  {
    id: "admin-security",
    subsystem: "admin",
    session: "admin",
    path: "/admin/security",
    heading: "Security",
    expectedText: /Trusted proxy|Recent security events/i,
  },

  {
    id: "admin-series",
    subsystem: "admin",
    session: "admin",
    path: "/admin/series",
    heading: "Reading series",
    expectedText: /New series|No series yet|Reading series/i,
  },

  {
    id: "admin-analytics",
    subsystem: "admin",
    session: "admin",
    path: "/admin/analytics",
    heading: "Analytics",
    expectedText: /Conversion funnel|Feature usage/i,
  },

  {
    id: "admin-ai-ops",
    subsystem: "admin",
    session: "admin",
    path: "/admin/analytics/ai",
    heading: /AI .* content ops/i,
    expectedText: /Total tokens/i,
  },

];

const ROUTE_GROUPS = [
  ...PUBLIC_AUTH_ONBOARDING_ROUTES,
  ...READER_LEARNING_ROUTES,
  ...CLASSROOM_ROUTES,
  ...ADMIN_OPERATIONS_ROUTES,
];

const ROUTES_BY_ID = new Map(ROUTE_GROUPS.map((route) => [route.id, route]));

const ORIGINAL_ROUTE_ORDER = [
  "marketing-home-anon",
  "signin-anon",
  "signin-error-anon",
  "marketing-home-reader",
  "auth-redirect-dashboard",
  "auth-redirect-browse",
  "auth-redirect-reader",
  "auth-redirect-study",
  "auth-redirect-teacher",
  "auth-redirect-assignments",
  "onboarding-new-reader",
  "dashboard-new-reader-redirect",
  "dashboard-reader",
  "dashboard-reader-level-filter",
  "browse-reader-all",
  "browse-reader-tech",
  "browse-reader-picks",
  "reader-article-controls",
  "reader-article-practice-tools",
  "today-reader-plan",
  "today-reader-skip",
  "study-reader",
  "study-words-reader",
  "offline-reader",
  "notes-reader-empty",
  "progress-reader-empty",
  "lists-reader-empty",
  "tags-reader-index",
  "tags-reader-tech-detail",
  "import-reader",
  "settings-reader",
  "series-reader-empty",
  "assignments-reader-empty",
  "teacher-reader-empty",
  "welcome-reader",
  "admin-dashboard",
  "admin-articles",
  "admin-articles-filtered",
  "admin-article-detail",
  "admin-jobs",
  "admin-jobs-filtered",
  "admin-members",
  "admin-member-detail",
  "admin-reports",
  "admin-tags",
  "admin-sources",
  "admin-security",
  "admin-series",
  "admin-analytics",
  "admin-ai-ops",
  "privacy-public",
  "terms-public",
];

export const ROUTES: RouteProfile[] = ORIGINAL_ROUTE_ORDER.map((routeId) => {
  const route = ROUTES_BY_ID.get(routeId);
  if (!route) throw new Error(`Missing UI audit route ${routeId}`);
  return route;
});

export const SCENARIOS: Scenario[] = ROUTES.flatMap((route) =>
  INTENTS.flatMap((intent) =>
    PRESENTATIONS.map((presentation) => ({ route, intent, presentation })),
  ),
).map((scenario, index) => ({
  ...scenario,
  caseId: `audit-case-${String(index + 1).padStart(3, "0")}`,
}));

if (SCENARIOS.length !== 520) {
  throw new Error(`UI audit must register exactly 520 scenarios; got ${SCENARIOS.length}`);
}

function regexSource(value: string | RegExp): string {
  return value instanceof RegExp ? value.toString() : value;
}

function truncateLog(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, MAX_LOG_LENGTH);
}

function expectedPathname(profile: RouteProfile): string {
  if (profile.expectedPathname) return profile.expectedPathname;
  return new URL(profile.path, "http://readwise.local").pathname;
}

async function signInForProfile(signIn: SignIn, session: SessionState): Promise<void> {
  if (session === "anonymous") return;

  await signIn({
    role: session === "admin" ? "Admin" : "Reader",
    onboarded: session !== "new-reader",
  });
}

async function applyPresentation(
  context: BrowserContext,
  page: Page,
  presentation: Presentation,
): Promise<void> {
  await page.setViewportSize(presentation.viewport);
  await page.emulateMedia({ colorScheme: presentation.theme });
  await context.addInitScript(
    ({ key, theme }) => {
      window.localStorage.setItem(key, theme);
    },
    { key: THEME_STORAGE_KEY, theme: presentation.theme },
  );
}

function installAuditCapture(page: Page): AuditLogs {
  const logs: AuditLogs = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverResponses: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      logs.consoleErrors.push(truncateLog(message.text()));
    }
  });
  page.on("pageerror", (error) => {
    logs.pageErrors.push(truncateLog(error.stack ?? error.message));
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    logs.failedRequests.push(
      truncateLog(`${request.method()} ${request.url()} ${failure?.errorText ?? "failed"}`),
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      logs.serverResponses.push(truncateLog(`${response.status()} ${response.url()}`));
    }
  });

  return logs;
}

function fatalMessages(logs: AuditLogs): string[] {
  return [...logs.consoleErrors, ...logs.pageErrors, ...logs.serverResponses].filter((message) =>
    logs.serverResponses.includes(message) || FATAL_PATTERNS.some((pattern) => pattern.test(message)),
  );
}

async function attachAuditLogs(testInfo: TestInfo, logs: AuditLogs): Promise<void> {
  await testInfo.attach("ui-audit-errors", {
    body: JSON.stringify(logs, null, 2),
    contentType: "application/json",
  });
}

async function appendAuditResult(
  scenario: Scenario,
  testInfo: TestInfo,
  logs: AuditLogs,
  error: unknown,
): Promise<void> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const record = {
    caseId: scenario.caseId,
    title: testInfo.title,
    status: error ? "failed" : "passed",
    subsystem: scenario.route.subsystem,
    routeId: scenario.route.id,
    path: scenario.route.path,
    expectedPathname: expectedPathname(scenario.route),
    session: scenario.route.session,
    intent: scenario.intent.id,
    presentation: scenario.presentation.id,
    viewport: scenario.presentation.viewport,
    theme: scenario.presentation.theme,
    logs,
    error: error instanceof Error ? truncateLog(error.stack ?? error.message) : null,
  };
  await appendFile(RESULTS_PATH, `${JSON.stringify(record)}\n`);
}

async function assertCoreRender(page: Page, profile: RouteProfile): Promise<void> {
  const response = await page.goto(profile.path);
  if (response) expect(response.status()).toBeLessThan(500);

  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPathname(profile));
  await expect(page.getByRole("heading", { name: profile.heading }).first()).toBeVisible();

  if (profile.expectedText) {
    await expect(page.getByText(profile.expectedText).first()).toBeVisible();
  }
}

async function assertSemanticSmoke(page: Page, profile: RouteProfile): Promise<void> {
  await assertCoreRender(page, profile);
  await expect(page.locator("main, [role='main'], section, article").first()).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
}

async function assertKeyboardFocus(page: Page, profile: RouteProfile): Promise<void> {
  await assertCoreRender(page, profile);
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ""))
    .not.toBe("BODY");
}

async function assertThemeAndOverflow(
  page: Page,
  profile: RouteProfile,
  presentation: Presentation,
): Promise<void> {
  await assertCoreRender(page, profile);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? ""))
    .toBe(presentation.theme);
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(4);
}

async function assertRouteBehavior(page: Page, profile: RouteProfile): Promise<void> {
  await assertCoreRender(page, profile);

  switch (profile.id) {
    case "marketing-home-anon":
      await page.getByRole("link", { name: /Get Started/i }).first().click();
      await expect(page).toHaveURL(/\/signin/);
      break;
    case "signin-anon":
      await page.getByRole("link", { name: "Back to home" }).click();
      await expect(page).toHaveURL(/\/$/);
      break;
    case "signin-error-anon":
      await expect(
        page.getByRole("alert").filter({ hasText: /problem|wrong|unable|try/i }).first(),
      ).toBeVisible();
      break;
    case "marketing-home-reader":
      await expect(page.getByRole("link", { name: /Continue Reading/i }).first()).toBeVisible();
      break;
    case "onboarding-new-reader":
    case "dashboard-new-reader-redirect":
      await expect(page.getByRole("heading", { name: "Your English level" }).first()).toBeVisible();
      break;
    case "dashboard-reader":
    case "dashboard-reader-level-filter":
      await expect(page.getByRole("link", { name: /E2E Critical Reading/i }).first()).toBeVisible();
      break;
    case "browse-reader-all":
    case "browse-reader-tech":
    case "browse-reader-picks":
      await expect(page.getByRole("link", { name: /E2E .*Practice|E2E Critical Reading/i }).first()).toBeVisible();
      break;
    case "reader-article-controls":
      await page.getByLabel("Display settings").click();
      await expect(page.getByRole("dialog", { name: "Display settings" }).first()).toBeVisible();
      break;
    case "reader-article-practice-tools":
      await page.getByRole("button", { name: "Practice tools", exact: true }).click();
      await expect(page.getByRole("tablist", { name: "Choose a practice tool" }).first()).toBeVisible();
      break;
    case "today-reader-plan":
      await expect(page.getByRole("link", { name: "Open reader" }).first()).toHaveAttribute(
        "href",
        `/reader/${TEST_ARTICLE_ID}`,
      );
      break;
    case "today-reader-skip":
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/today/skip") && response.status() < 500,
          { timeout: 30_000 },
        ),
        page.getByRole("button", { name: "Skip today" }).click(),
      ]);
      await expect(page.getByText("Skipped today", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      break;
    case "study-reader":
      await expect(page.getByRole("link", { name: /Vocabulary|Words/i }).first()).toBeVisible();
      break;
    case "study-words-reader":
      await expect(page.getByRole("link", { name: "Back to Study hub" }).first()).toBeVisible();
      break;
    case "offline-reader":
      await expect(page.getByText(/No articles saved offline yet|Articles saved here/i).first()).toBeVisible();
      break;
    case "notes-reader-empty":
      await expect(page.getByPlaceholder("Search highlights & notes…").first()).toBeVisible();
      break;
    case "progress-reader-empty":
      await expect(page.getByText(/No reading activity|No quiz attempts/i).first()).toBeVisible();
      break;
    case "lists-reader-empty":
      await expect(page.getByRole("link", { name: "Browse articles" }).first()).toBeVisible();
      break;
    case "tags-reader-index":
      await expect(page.getByRole("link", { name: /Technology/ }).first()).toBeVisible();
      break;
    case "tags-reader-tech-detail":
      await expect(page.getByRole("link", { name: /E2E Critical Reading/i }).first()).toBeVisible();
      break;
    case "import-reader":
      await page.getByPlaceholder("https://example.com/article").fill("https://example.com/audit");
      await expect(page.getByPlaceholder("https://example.com/article")).toHaveValue(
        "https://example.com/audit",
      );
      break;
    case "settings-reader":
      await expect(page.getByText("Choose your preferred app theme.").first()).toBeVisible();
      break;
    case "series-reader-empty":
      await expect(page.getByText(/No reading series are available yet/i).first()).toBeVisible();
      break;
    case "assignments-reader-empty":
      await expect(page.getByText("No assignments yet").first()).toBeVisible();
      break;
    case "teacher-reader-empty":
      await expect(page.getByText("No classrooms yet").first()).toBeVisible();
      break;
    case "welcome-reader":
      await expect(page.getByRole("heading", { name: "Welcome to ReadWise" }).first()).toBeVisible();
      break;
    case "admin-articles":
    case "admin-articles-filtered":
      await page.getByRole("searchbox", { name: "Search articles" }).fill("E2E");
      await expect(page.getByRole("searchbox", { name: "Search articles" })).toHaveValue("E2E");
      break;
    case "admin-jobs":
    case "admin-jobs-filtered":
      await expect(page.getByLabel("Filter by status").first()).toBeVisible();
      break;
    case "admin-members":
      await page.getByRole("searchbox", { name: "Search members" }).fill("E2E");
      await expect(page.getByRole("searchbox", { name: "Search members" })).toHaveValue("E2E");
      break;
    case "admin-member-detail":
      await expect(page.getByRole("link", { name: /Back to members/i }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Support actions" }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Admin action history" }).first()).toBeVisible();
      break;
    case "admin-reports":
      await expect(page.getByLabel("Filter by status").first()).toBeVisible();
      break;
    case "admin-tags":
      await page.getByRole("searchbox", { name: "Search tags" }).fill("tech");
      await expect(page.getByRole("searchbox", { name: "Search tags" })).toHaveValue("tech");
      break;
    case "admin-sources":
      await expect(page.getByRole("button", { name: /Sync from registry/i }).first()).toBeVisible();
      break;
    case "admin-security":
      await expect(page.getByText("Recent security events").first()).toBeVisible();
      break;
    case "admin-analytics":
      await expect(page.getByText("Conversion funnel").first()).toBeVisible();
      break;
    case "admin-ai-ops":
      await expect(page.getByText(/Total tokens/i).first()).toBeVisible();
      break;
    default:
      if (profile.expectedText) {
        await expect(page.getByText(profile.expectedText).first()).toBeVisible();
      }
      break;
  }
}

async function runScenario(page: Page, scenario: Scenario): Promise<void> {
  switch (scenario.intent.id) {
    case "render":
      await assertCoreRender(page, scenario.route);
      break;
    case "semantic-smoke":
      await assertSemanticSmoke(page, scenario.route);
      break;
    case "keyboard-focus":
      await assertKeyboardFocus(page, scenario.route);
      break;
    case "route-behavior":
      await assertRouteBehavior(page, scenario.route);
      break;
    case "theme-overflow":
      await assertThemeAndOverflow(page, scenario.route, scenario.presentation);
      break;
    default:
      throw new Error(`Unknown audit intent ${scenario.intent.id}`);
  }
}

export function scenarioTitle(scenario: Scenario): string {
  const tags = [
    "@ui-audit",
    `@${scenario.route.subsystem}`,
    `@${scenario.route.session}`,
    `@${scenario.intent.id}`,
    `@${scenario.presentation.id}`,
    ...(scenario.route.tags ?? []),
  ].join(" ");
  return `${scenario.caseId} ${tags} ${scenario.route.id}: ${scenario.intent.title} on ${scenario.presentation.title}`;
}

let auditRunInitialized: Promise<void> | null = null;

export async function initializeUiAuditRun(): Promise<void> {
  auditRunInitialized ??= writeAuditRunArtifacts();
  await auditRunInitialized;
}

async function writeAuditRunArtifacts(): Promise<void> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(
    LATEST_RUN_PATH,
    `${JSON.stringify(
      {
        runId: RUN_ID,
        resultsPath: path.relative(process.cwd(), RESULTS_PATH),
        catalogPath: path.relative(process.cwd(), CATALOG_PATH),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    CATALOG_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scenarioCount: SCENARIOS.length,
        matrix: {
          routes: ROUTES.length,
          intents: INTENTS.length,
          presentations: PRESENTATIONS.length,
        },
        scenarios: SCENARIOS.map((scenario) => ({
          caseId: scenario.caseId,
          routeId: scenario.route.id,
          subsystem: scenario.route.subsystem,
          session: scenario.route.session,
          path: scenario.route.path,
          expectedPathname: expectedPathname(scenario.route),
          heading: regexSource(scenario.route.heading),
          expectedText: scenario.route.expectedText ? regexSource(scenario.route.expectedText) : null,
          intent: scenario.intent.id,
          presentation: scenario.presentation.id,
          viewport: scenario.presentation.viewport,
          theme: scenario.presentation.theme,
          tags: scenario.route.tags ?? [],
        })),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(RESULTS_PATH, "");
}

export function scenariosForRoutes(routes: readonly RouteProfile[]): Scenario[] {
  const routeIds = new Set(routes.map((route) => route.id));
  const scenarios = SCENARIOS.filter((scenario) => routeIds.has(scenario.route.id));
  const expectedScenarioCount = routes.length * INTENTS.length * PRESENTATIONS.length;

  if (scenarios.length !== expectedScenarioCount) {
    throw new Error(
      `UI audit split registered ${scenarios.length} scenarios for ${routes.length} routes; expected ${expectedScenarioCount}`,
    );
  }

  return scenarios;
}

export async function runUiAuditScenario({
  context,
  page,
  signIn,
  testInfo,
  scenario,
}: {
  context: BrowserContext;
  page: Page;
  signIn: SignIn;
  testInfo: TestInfo;
  scenario: Scenario;
}): Promise<void> {
  const logs = installAuditCapture(page);
  let caughtError: unknown = null;

  try {
    await applyPresentation(context, page, scenario.presentation);
    await signInForProfile(signIn, scenario.route.session);
    await runScenario(page, scenario);

    const fatal = fatalMessages(logs);
    expect(fatal, `fatal browser/render errors for ${scenario.caseId}`).toEqual([]);
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    await attachAuditLogs(testInfo, logs);
    await appendAuditResult(scenario, testInfo, logs, caughtError);
  }
}
