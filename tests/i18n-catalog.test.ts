/**
 * i18n catalog smoke tests (#733).
 *
 * Asserts that every catalog key currently supported by the English catalog
 * resolves to the expected user-facing English string. These tests serve two
 * purposes:
 *
 *   1. Regression guard — a mistaken wording change in en.ts fails here.
 *   2. Migration verification — when a call site moves a hard-coded string
 *      to t(), add the corresponding assertion here.
 *
 * Run with: npm test -- --test-name-pattern "i18n"
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { t } from "@/lib/i18n";

describe("i18n catalog — key resolution", () => {
  // ---------------------------------------------------------------------------
  // Reader
  // ---------------------------------------------------------------------------

  test('reader.translate.unavailable resolves with lang param', () => {
    const msg = t("reader.translate.unavailable", { lang: "Spanish" });
    assert.ok(msg.includes("Spanish"), `Expected "Spanish" in: ${msg}`);
    assert.ok(msg.includes("not configured"), `Expected "not configured" in: ${msg}`);
    assert.ok(msg.includes("Please try again later"), `Expected retry prompt in: ${msg}`);
  });

  test('reader.translate.unavailable interpolates lang correctly', () => {
    assert.equal(
      t("reader.translate.unavailable", { lang: "French" }),
      "Translation into French is unavailable right now because the AI " +
        "translation service is not configured. Please try again later.",
    );
  });

  // ---------------------------------------------------------------------------
  // AI provider fallback messages
  // ---------------------------------------------------------------------------

  test('ai.tutor.unavailable resolves to expected English string', () => {
    assert.equal(
      t("ai.tutor.unavailable"),
      "AI feature unavailable — the AI tutor is not available right now. Please try again later.",
    );
  });

  test('ai.quiz.unavailable resolves to expected English string', () => {
    assert.equal(
      t("ai.quiz.unavailable"),
      "AI feature unavailable — quiz generation is not available right now. Please try again later.",
    );
  });

  test('ai.translation.unavailable resolves to expected English string', () => {
    assert.equal(
      t("ai.translation.unavailable"),
      "AI feature unavailable — translation is not available right now.",
    );
  });

  test('ai.vocabulary.unavailable.title resolves to expected English string', () => {
    assert.equal(t("ai.vocabulary.unavailable.title"), "Vocabulary unavailable");
  });

  test('ai.vocabulary.unavailable.description resolves to expected English string', () => {
    assert.equal(
      t("ai.vocabulary.unavailable.description"),
      "AI vocabulary extraction is not available right now. Please try again later.",
    );
  });

  // ---------------------------------------------------------------------------
  // Push notifications
  // ---------------------------------------------------------------------------

  test('push.reminder.title resolves to expected English string', () => {
    assert.equal(t("push.reminder.title"), "Time to review! 📚");
  });

  test('push.reminder.body singular (count=1)', () => {
    const msg = t("push.reminder.body", { count: 1 });
    assert.ok(msg.includes("1 word"), `Expected "1 word" in: ${msg}`);
    assert.ok(!msg.includes("words"), `Expected singular form in: ${msg}`);
    assert.ok(msg.includes("ReadWise"), `Expected site name in: ${msg}`);
  });

  test('push.reminder.body plural (count>1)', () => {
    const msg = t("push.reminder.body", { count: 5 });
    assert.ok(msg.includes("5 words"), `Expected "5 words" in: ${msg}`);
    assert.ok(msg.includes("ReadWise"), `Expected site name in: ${msg}`);
  });

  test('push.reminder.body plural matches original copy exactly (count=3)', () => {
    assert.equal(
      t("push.reminder.body", { count: 3 }),
      "You have 3 words due for review in ReadWise.",
    );
  });

  test('push.reminder.body singular matches original copy exactly (count=1)', () => {
    assert.equal(
      t("push.reminder.body", { count: 1 }),
      "You have 1 word due for review in ReadWise.",
    );
  });

  // ---------------------------------------------------------------------------
  // Missing key fallback
  // ---------------------------------------------------------------------------

  test('t() falls back to key string for unknown keys', () => {
    // Cast required to test the runtime fallback path without a TS error.
    const result = (t as (key: string) => string)("nonexistent.key.xyz");
    assert.equal(result, "nonexistent.key.xyz");
  });
});
