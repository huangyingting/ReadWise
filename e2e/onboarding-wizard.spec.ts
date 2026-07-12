/**
 * E2E journey: non-onboarded reader completes the five-step onboarding wizard.
 *
 * Refs #1009 — first-run funnel was smoke-tested at the first heading only.
 * This test exercises all five wizard steps with synthetic inputs, asserts
 * validation and navigation controls (including keyboard reachability), and
 * proves the final redirect to /welcome.
 *
 * Steps exercised:
 *  1. Level     — select B1 (required; Next blocked until a selection is made)
 *  2. Placement — answer all 3 quiz questions; confirm no forced level change
 *  3. Topics    — toggle two topic chips
 *  4. About     — select age range and gender (both optional)
 *  5. Review    — verify summary rows; click Finish setup; assert /welcome
 *
 * Design constraints:
 *  - Uses the existing non-onboarded reader fixture (signIn({ onboarded: false }))
 *  - No live AI / speech / push provider dependency
 *  - No sleep-based waits; all waits are assertion-driven
 *  - No broad snapshots; no duplicate fixtures
 */

import { test, expect } from "./support/fixtures";

test("completes the five-step onboarding wizard and reaches the welcome screen", async ({
  signIn,
  page,
}) => {
  await signIn({ onboarded: false });
  await page.goto("/onboarding");

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1 · Level — "Your English level"
  // ──────────────────────────────────────────────────────────────────────────

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Welcome to ReadWise" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your English level" })).toBeVisible();

  // Step progress indicator
  await expect(page.getByText("Step 1 of 5")).toBeVisible();

  // Next is disabled until a level is selected (validation guard)
  const nextButton = page.getByRole("button", { name: "Next", exact: true });
  await expect(nextButton).toBeDisabled();

  // Select B1 level by clicking the visible label that wraps the sr-only radio
  await page.locator("label:has(input[value='B1'])").click();
  await expect(nextButton).toBeEnabled();

  // Keyboard reachability: Next button has no tabindex barrier after selection
  const nextTabIndex = await nextButton.evaluate(
    (el) => (el as HTMLButtonElement).tabIndex,
  );
  expect(nextTabIndex).toBeGreaterThanOrEqual(0);

  await nextButton.click();

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2 · Placement — "Confirm your level"
  // ──────────────────────────────────────────────────────────────────────────

  await expect(page.getByRole("heading", { name: /Confirm your level/ })).toBeVisible();
  await expect(page.getByText("Step 2 of 5")).toBeVisible();

  // Back button present and keyboard-reachable
  const backButton = page.getByRole("button", { name: "Back" });
  await expect(backButton).toBeVisible();
  await expect(backButton).not.toBeDisabled();
  const backTabIndex = await backButton.evaluate(
    (el) => (el as HTMLButtonElement).tabIndex,
  );
  expect(backTabIndex).toBeGreaterThanOrEqual(0);

  // Skip is available on this step
  const skipButton = page.getByRole("button", { name: /Skip/ });
  await expect(skipButton).toBeVisible();

  // Answer all three B1 questions with the correct options so no level
  // suggestion is triggered (score 3/3 > 1/3 threshold).
  await page
    .locator("label", { hasText: "Both physical health and mental well-being" })
    .click();
  await page.locator("label", { hasText: "The ticket prices" }).click();
  await page.locator("label", { hasText: "It provides more flexibility" }).click();

  // Score panel appears after all three are answered
  await expect(page.getByText(/You got 3 out of 3/)).toBeVisible();
  // No level suggestion panel — "Great job" message confirms correct level
  await expect(page.getByText("Great job! Your selected level looks right.")).toBeVisible();

  await nextButton.click();

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3 · Topics — "What do you like to read?"
  // ──────────────────────────────────────────────────────────────────────────

  await expect(page.getByRole("heading", { name: "What do you like to read?" })).toBeVisible();
  await expect(page.getByText("Step 3 of 5")).toBeVisible();

  // Toggle two topic chips (aria-pressed chips from TopicSelector)
  const scienceChip = page.getByRole("button", { name: "Science" });
  const healthChip = page.getByRole("button", { name: "Health" });
  await scienceChip.click();
  await healthChip.click();
  await expect(scienceChip).toHaveAttribute("aria-pressed", "true");
  await expect(healthChip).toHaveAttribute("aria-pressed", "true");

  await nextButton.click();

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4 · About — "A little about you"
  // ──────────────────────────────────────────────────────────────────────────

  await expect(page.getByRole("heading", { name: "A little about you" })).toBeVisible();
  await expect(page.getByText("Step 4 of 5")).toBeVisible();

  // Select age range and gender via labeled <select> elements
  await page.getByLabel("Age range").selectOption("25-34");
  await page.getByLabel("Gender").selectOption("Male");

  await nextButton.click();

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5 · Review — "You're all set!"
  // ──────────────────────────────────────────────────────────────────────────

  await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible();
  await expect(page.getByText("Step 5 of 5")).toBeVisible();

  // Summary rows reflect the choices made in the preceding steps
  await expect(page.getByText(/B1/)).toBeVisible();
  await expect(page.getByText(/Science/)).toBeVisible();
  await expect(page.getByText(/Health/)).toBeVisible();
  await expect(page.getByText("25-34")).toBeVisible();
  await expect(page.getByText("Male")).toBeVisible();

  // Finish setup button is present and keyboard-reachable
  const finishButton = page.getByRole("button", { name: "Finish setup" });
  await expect(finishButton).toBeVisible();
  await expect(finishButton).not.toBeDisabled();
  const finishTabIndex = await finishButton.evaluate(
    (el) => (el as HTMLButtonElement).tabIndex,
  );
  expect(finishTabIndex).toBeGreaterThanOrEqual(0);

  // ──────────────────────────────────────────────────────────────────────────
  // Submit — assert the user leaves /onboarding for /welcome
  // ──────────────────────────────────────────────────────────────────────────

  await finishButton.click();

  // Wait for the API POST to complete and router.push("/welcome") to fire
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 15_000 });

  // Welcome tour first step is the reliable marker that the post-onboarding
  // screen rendered correctly for an authenticated, now-onboarded user
  await expect(
    page.getByRole("heading", { name: "Read articles at your level" }),
  ).toBeVisible();
});
