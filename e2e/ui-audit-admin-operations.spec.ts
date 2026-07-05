/**
 * Playwright UI audit scenarios for admin operations routes.
 */
import { test } from "./support/fixtures";
import {
  ADMIN_OPERATIONS_ROUTES,
  initializeUiAuditRun,
  runUiAuditScenario,
  scenarioTitle,
  scenariosForRoutes,
} from "./support/ui-audit";

test.beforeAll(initializeUiAuditRun);

for (const scenario of scenariosForRoutes(ADMIN_OPERATIONS_ROUTES)) {
  test(scenarioTitle(scenario), async ({ context, page, signIn }, testInfo) => {
    await runUiAuditScenario({ context, page, signIn, testInfo, scenario });
  });
}
