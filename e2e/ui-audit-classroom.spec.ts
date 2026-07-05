/**
 * Playwright UI audit scenarios for classroom routes.
 */
import { test } from "./support/fixtures";
import {
  CLASSROOM_ROUTES,
  initializeUiAuditRun,
  runUiAuditScenario,
  scenarioTitle,
  scenariosForRoutes,
} from "./support/ui-audit";

test.beforeAll(initializeUiAuditRun);

for (const scenario of scenariosForRoutes(CLASSROOM_ROUTES)) {
  test(scenarioTitle(scenario), async ({ context, page, signIn }, testInfo) => {
    await runUiAuditScenario({ context, page, signIn, testInfo, scenario });
  });
}
