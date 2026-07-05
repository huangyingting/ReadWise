/**
 * Playwright UI audit scenarios for reader learning, library, and settings routes.
 */
import { test } from "./support/fixtures";
import {
  READER_LEARNING_ROUTES,
  initializeUiAuditRun,
  runUiAuditScenario,
  scenarioTitle,
  scenariosForRoutes,
} from "./support/ui-audit";

test.beforeAll(initializeUiAuditRun);

for (const scenario of scenariosForRoutes(READER_LEARNING_ROUTES)) {
  test(scenarioTitle(scenario), async ({ context, page, signIn }, testInfo) => {
    await runUiAuditScenario({ context, page, signIn, testInfo, scenario });
  });
}
