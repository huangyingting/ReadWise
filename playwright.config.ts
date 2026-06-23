import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const appUrl = new URL(baseURL);
const databaseUrl = process.env.PLAYWRIGHT_DATABASE_URL ?? "file:./e2e.db";
const chromiumExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  path.join(
    homedir(),
    ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
  );

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
};

for (const [key, value] of Object.entries(e2eEnv)) {
  process.env[key] = value;
}

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
    command: `npx prisma migrate deploy && npx next dev -H ${appUrl.hostname} -p ${appUrl.port || "3000"}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: e2eEnv,
  },
});
