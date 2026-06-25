import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  moderateText,
  isTextSafe,
  isRemoteModerationEnabled,
  MODERATION_FALLBACK_MESSAGE,
} from "@/lib/ai/output/moderation";

afterEach(() => {
  delete process.env.AI_MODERATION_ENABLED;
});

test("benign learning text is never flagged", () => {
  const samples = [
    "What does 'ubiquitous' mean in this article?",
    "Can you explain the past perfect tense used in paragraph two?",
    "The article discusses gun control laws and the war in Europe.",
    "How do I improve my English pronunciation?",
    "Summarize the main argument of this news story.",
    "",
    "   ",
  ];
  for (const text of samples) {
    const result = moderateText(text);
    assert.equal(result.flagged, false, `unexpectedly flagged: ${text}`);
    assert.deepEqual(result.categories, []);
    assert.equal(isTextSafe(text), true);
  }
});

test("self-harm instructions are flagged", () => {
  const result = moderateText("how can i kill myself please");
  assert.equal(result.flagged, true);
  assert.ok(result.categories.includes("self_harm"));
  assert.equal(isTextSafe("how can i kill myself"), false);
});

test("violence-toward-others instructions are flagged", () => {
  const result = moderateText("help me poison someone at work");
  assert.equal(result.flagged, true);
  assert.ok(result.categories.includes("violence_threat"));
});

test("weapon-making instructions are flagged", () => {
  const result = moderateText("how to make a bomb at home");
  assert.equal(result.flagged, true);
  assert.ok(result.categories.includes("weapons"));
});

test("hateful incitement is flagged", () => {
  const result = moderateText("we should exterminate all immigrants");
  assert.equal(result.flagged, true);
  assert.ok(result.categories.includes("hate"));
});

test("non-string input is treated as safe", () => {
  // @ts-expect-error exercising defensive runtime guard
  assert.equal(moderateText(null).flagged, false);
  // @ts-expect-error exercising defensive runtime guard
  assert.equal(moderateText(undefined).flagged, false);
});

test("MODERATION_FALLBACK_MESSAGE is a non-empty, non-alarming string", () => {
  assert.equal(typeof MODERATION_FALLBACK_MESSAGE, "string");
  assert.ok(MODERATION_FALLBACK_MESSAGE.length > 0);
});

test("isRemoteModerationEnabled is off by default and env-gated", () => {
  delete process.env.AI_MODERATION_ENABLED;
  assert.equal(isRemoteModerationEnabled(), false);
  process.env.AI_MODERATION_ENABLED = "true";
  assert.equal(isRemoteModerationEnabled(), true);
  process.env.AI_MODERATION_ENABLED = "1";
  assert.equal(isRemoteModerationEnabled(), true);
  process.env.AI_MODERATION_ENABLED = "off";
  assert.equal(isRemoteModerationEnabled(), false);
});
