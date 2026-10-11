/**
 * Playwright UI audit scenarios for admin operations routes.
 */
import { expect, test } from "./support/fixtures";
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

test("invitation email and expiry controls align", async ({ adminPage }) => {
  await adminPage.goto("/admin/invitations");

  const email = adminPage.getByLabel("Email");
  const expiry = adminPage.getByLabel("Expiry (optional)");
  await expect(email).toBeVisible();
  await expect(expiry).toBeVisible();

  const [emailBox, expiryBox] = await Promise.all([
    email.boundingBox(),
    expiry.boundingBox(),
  ]);
  expect(emailBox).not.toBeNull();
  expect(expiryBox).not.toBeNull();
  expect(Math.abs(emailBox!.y - expiryBox!.y)).toBeLessThanOrEqual(1);
});
