import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const appUrl = new URL(baseURL);
const databaseUrl = process.env.PLAYWRIGHT_DATABASE_URL ?? "file:./e2e.db";
const defaultChromiumExecutable = path.join(
  homedir(),
  ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
);
const chromiumExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? defaultChromiumExecutable;
const e2eNodeOptions = [
  process.env.NODE_OPTIONS,
  "--max-old-space-size=8192",
]
  .filter(Boolean)
  .join(" ");

const e2eEnv = {
  DATABASE_URL: databaseUrl,
  NEXTAUTH_SECRET: "readwise-playwright-smoke-secret",
  NEXTAUTH_URL: baseURL,
  LOG_LEVEL: "error",
  AZURE_OPENAI_ENDPOINT: "",
  AZURE_OPENAI_API_KEY: "",
  AZURE_OPENAI_DEPLOYMENT: "",
  AZURE_OPENAI_API_VERSION: "",
  AZURE_SPEECH_KEY: "",
  AZURE_SPEECH_REGION: "",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  AZURE_AD_CLIENT_ID: "",
  AZURE_AD_CLIENT_SECRET: "",
  AZURE_AD_TENANT_ID: "",
  MEDIA_STORAGE: "local",
  AZURE_STORAGE_CONNECTION_STRING: "",
  AZURE_STORAGE_ACCOUNT: "",
  AZURE_STORAGE_KEY: "",
  READWISE_DISABLE_LISTING_CACHE: "1",
  NEXT_DIST_DIR: ".next-e2e",
  // The 627-case suite keeps one webpack dev server alive for over an hour.
  // Next restarts dev servers at 80% of V8's heap limit, which otherwise drops
  // whichever Playwright navigation happens to be in flight late in the run.
  NODE_OPTIONS: e2eNodeOptions,
};

for (const [key, value] of Object.entries(e2eEnv)) {
  process.env[key] = value;
}

const host = appUrl.hostname;
const port = appUrl.port || "3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(existsSync(chromiumExecutable)
        ? { executablePath: chromiumExecutable }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: `npx prisma migrate deploy && npx next dev --webpack -H ${host} -p ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: e2eEnv,
  },
});
