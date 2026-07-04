/**
 * E2E: unauthenticated redirect guards.
 *
 * Verifies that every protected route (dashboard, reader, browse, study)
 * redirects an unauthenticated visitor to the sign-in page.
 * No user session is set up — cookies are cleared before each test.
 */
import { test, expect } from "./support/fixtures";

const PROTECTED_ROUTES = [
  ["/dashboard", "/dashboard"],
  ["/browse", "/browse"],
  ["/reader/:id", "/reader/any-article-id"],
  ["/study", "/study"],
  ["/progress", "/progress"],
] as const;

for (const [routeName, path] of PROTECTED_ROUTES) {
  test(`unauthenticated user is redirected to signin from ${routeName}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin/);
  });
}
