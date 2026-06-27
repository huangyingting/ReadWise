/**
 * Tests for feature kill switches in src/lib/runtime-config/feature-flags.ts
 * and their effect on provider entry points (AI, TTS/speech, push, scraper).
 *
 * Pattern: flag off → feature degrades like unconfigured (no throws, null/fallback).
 *          flag on / absent → unchanged behavior.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isFeatureEnabled,
  isAiFeatureEnabled,
  isTtsFeatureEnabled,
  isPushFeatureEnabled,
  isScraperFeatureEnabled,
  isTodaySessionFeatureEnabled,
  type FeatureKey,
} from "@/lib/runtime-config/feature-flags";
import { isAiConfigured, chatComplete } from "@/lib/ai";
import { isSpeechConfigured } from "@/lib/speech";
import { isPushConfigured, vapidPublicKey } from "@/lib/push/provider";
import { scrapeUrl, scrapeAndSave } from "@/lib/scraper";

// ---------------------------------------------------------------------------
// Helpers to save / restore env vars
// ---------------------------------------------------------------------------

const FLAG_VARS = [
  "FEATURE_AI_ENABLED",
  "FEATURE_TTS_ENABLED",
  "FEATURE_PUSH_ENABLED",
  "FEATURE_SCRAPER_ENABLED",
  "FEATURE_TODAY_SESSION_ENABLED",
] as const;

const AI_KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
] as const;

const SPEECH_KEYS = ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"] as const;

const PUSH_KEYS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

const ALL_MANAGED_KEYS = [...FLAG_VARS, ...AI_KEYS, ...SPEECH_KEYS, ...PUSH_KEYS] as const;

let savedEnv: Partial<Record<(typeof ALL_MANAGED_KEYS)[number], string | undefined>>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ALL_MANAGED_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ALL_MANAGED_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

function enableAiCreds() {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-test";
  process.env.AZURE_OPENAI_API_VERSION = "2024-02-01";
}

function enableSpeechCreds() {
  process.env.AZURE_SPEECH_KEY = "speech-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
}

// ---------------------------------------------------------------------------
// isFeatureEnabled — unit tests for the helper itself
// ---------------------------------------------------------------------------

test("isFeatureEnabled returns true when env var is absent (default enabled)", () => {
  for (const feature of ["ai", "tts", "push", "scraper"] as FeatureKey[]) {
    assert.equal(isFeatureEnabled(feature), true, `feature=${feature} should default to enabled`);
  }
});

test("isFeatureEnabled returns false for falsy string values", () => {
  for (const falsy of ["false", "0", "off", "FALSE", "OFF", "False"]) {
    process.env.FEATURE_AI_ENABLED = falsy;
    assert.equal(isFeatureEnabled("ai"), false, `expected disabled for "${falsy}"`);
  }
});

test("isFeatureEnabled returns true for truthy string values", () => {
  for (const truthy of ["true", "1", "on", "TRUE", "ON", "True", "yes", "anything"]) {
    process.env.FEATURE_AI_ENABLED = truthy;
    assert.equal(isFeatureEnabled("ai"), true, `expected enabled for "${truthy}"`);
  }
});

test("isFeatureEnabled gates are independent across features", () => {
  process.env.FEATURE_AI_ENABLED = "false";
  process.env.FEATURE_TTS_ENABLED = "true";
  process.env.FEATURE_PUSH_ENABLED = "0";
  process.env.FEATURE_SCRAPER_ENABLED = "1";

  assert.equal(isFeatureEnabled("ai"), false);
  assert.equal(isFeatureEnabled("tts"), true);
  assert.equal(isFeatureEnabled("push"), false);
  assert.equal(isFeatureEnabled("scraper"), true);
});

test("convenience helpers match isFeatureEnabled", () => {
  process.env.FEATURE_AI_ENABLED = "false";
  process.env.FEATURE_TTS_ENABLED = "false";
  process.env.FEATURE_PUSH_ENABLED = "false";
  process.env.FEATURE_SCRAPER_ENABLED = "false";
  process.env.FEATURE_TODAY_SESSION_ENABLED = "false";

  assert.equal(isAiFeatureEnabled(), false);
  assert.equal(isTtsFeatureEnabled(), false);
  assert.equal(isPushFeatureEnabled(), false);
  assert.equal(isScraperFeatureEnabled(), false);
  assert.equal(isTodaySessionFeatureEnabled(), false);
});

// ---------------------------------------------------------------------------
// AI kill switch wired into isAiConfigured / chatComplete
// ---------------------------------------------------------------------------

test("isAiConfigured returns false when FEATURE_AI_ENABLED=false even with credentials", () => {
  enableAiCreds();
  process.env.FEATURE_AI_ENABLED = "false";
  assert.equal(isAiConfigured(), false);
});

test("isAiConfigured returns true when FEATURE_AI_ENABLED=true and credentials present", () => {
  enableAiCreds();
  process.env.FEATURE_AI_ENABLED = "true";
  assert.equal(isAiConfigured(), true);
});

test("chatComplete returns null when FEATURE_AI_ENABLED=false (no network call)", async (t) => {
  enableAiCreds();
  process.env.FEATURE_AI_ENABLED = "false";
  process.env.AI_MAX_RETRIES = "0";

  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AI_MAX_RETRIES;
  });
  globalThis.fetch = (async () => {
    networkCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hello" }]);
  assert.equal(result, null);
  assert.equal(networkCalled, false, "network must not be called when AI is disabled");
});

// ---------------------------------------------------------------------------
// TTS / speech kill switch wired into isSpeechConfigured
// ---------------------------------------------------------------------------

test("isSpeechConfigured returns false when FEATURE_TTS_ENABLED=false even with credentials", () => {
  enableSpeechCreds();
  process.env.FEATURE_TTS_ENABLED = "false";
  assert.equal(isSpeechConfigured(), false);
});

test("isSpeechConfigured returns true when FEATURE_TTS_ENABLED=true and credentials present", () => {
  enableSpeechCreds();
  process.env.FEATURE_TTS_ENABLED = "true";
  assert.equal(isSpeechConfigured(), true);
});

test("isSpeechConfigured returns false when FEATURE_TTS_ENABLED absent and credentials absent", () => {
  assert.equal(isSpeechConfigured(), false);
});

// ---------------------------------------------------------------------------
// Push kill switch — tested via feature-flag layer (web-push init not exercised)
// ---------------------------------------------------------------------------

test("isPushFeatureEnabled returns false when FEATURE_PUSH_ENABLED=false", () => {
  process.env.FEATURE_PUSH_ENABLED = "false";
  assert.equal(isPushFeatureEnabled(), false);
});

test("isPushConfigured returns false when FEATURE_PUSH_ENABLED=false (short-circuits before web-push init)", () => {
  // Credentials present but kill switch off — isPushConfigured must short-circuit
  // before calling ensurePushInit() so no web-push validation side-effects occur.
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKey1234";
  process.env.VAPID_PRIVATE_KEY = "FakePrivateKey5678";
  process.env.VAPID_SUBJECT = "mailto:admin@example.com";
  process.env.FEATURE_PUSH_ENABLED = "false";
  assert.equal(isPushConfigured(), false);
});

test("vapidPublicKey returns null when FEATURE_PUSH_ENABLED=false", () => {
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKey1234";
  process.env.VAPID_PRIVATE_KEY = "FakePrivateKey5678";
  process.env.VAPID_SUBJECT = "mailto:admin@example.com";
  process.env.FEATURE_PUSH_ENABLED = "false";
  assert.equal(vapidPublicKey(), null);
});

// ---------------------------------------------------------------------------
// Scraper kill switch wired into scrapeUrl / scrapeAndSave
// ---------------------------------------------------------------------------

test("scrapeUrl returns null when FEATURE_SCRAPER_ENABLED=false (no network)", async (t) => {
  process.env.FEATURE_SCRAPER_ENABLED = "false";

  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => {
    networkCalled = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;

  const result = await scrapeUrl("https://example.com/article");
  assert.equal(result, null);
  assert.equal(networkCalled, false, "network must not be called when scraper is disabled");
});

test("scrapeAndSave returns failed outcome when FEATURE_SCRAPER_ENABLED=false", async () => {
  process.env.FEATURE_SCRAPER_ENABLED = "false";

  const outcome = await scrapeAndSave("https://example.com/article");
  assert.equal(outcome.status, "failed");
  assert.ok(
    "reason" in outcome && typeof outcome.reason === "string" && outcome.reason.includes("disabled"),
    `expected 'disabled' in reason, got: ${JSON.stringify(outcome)}`,
  );
});

// ---------------------------------------------------------------------------
// Default — all flags absent → features behave as before (no regression)
// ---------------------------------------------------------------------------

test("all features are enabled by default when no FEATURE_* env vars are set", () => {
  for (const feature of ["ai", "tts", "push", "scraper", "todaySession"] as FeatureKey[]) {
    assert.equal(isFeatureEnabled(feature), true, `${feature} must be enabled by default`);
  }
});
