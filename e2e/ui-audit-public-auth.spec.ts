/**
 * Playwright UI audit scenarios for public, auth, onboarding, and legal routes.
 */
import { test } from "./support/fixtures";
import {
  PUBLIC_AUTH_ONBOARDING_ROUTES,
  initializeUiAuditRun,
  runUiAuditScenario,
  scenarioTitle,
  scenariosForRoutes,
} from "./support/ui-audit";

test.beforeAll(initializeUiAuditRun);

for (const scenario of scenariosForRoutes(PUBLIC_AUTH_ONBOARDING_ROUTES)) {
  test(scenarioTitle(scenario), async ({ context, page, signIn }, testInfo) => {
    await runUiAuditScenario({ context, page, signIn, testInfo, scenario });
  });
}
