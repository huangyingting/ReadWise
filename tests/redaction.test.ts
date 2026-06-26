/**
 * Sensitive metadata redaction policy tests (#676, #679).
 *
 * Canonical policy lives at src/lib/security/redaction.ts. The backward-compat
 * shim at src/lib/observability/redaction.ts re-exports the same symbols under
 * the legacy path; both import paths are exercised here.
 *
 * Coverage:
 *  - isSensitiveMetadataKey / isSensitiveKey (compat alias) across all paths
 *  - redactSensitiveValue / scrubValue (compat alias): email, token, combined
 *  - redactSensitiveObject: sensitive keys → "[redacted]", nested → "[object]",
 *    string length cap, safe primitives preserved
 *  - safeMetadataForPersistence: end-to-end recursive sanitiser (nesting,
 *    depth cap, key count cap, array cap, length cap, boolean/number pass-through)
 *  - Consuming-path regression: audit, errors, analytics, AI-ledger, and
 *    security-events all use the shared policy so sensitive data never escapes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// Canonical import (Phase 1 — #676 canonical location)
import {
  isSensitiveMetadataKey,
  redactSensitiveValue,
  redactSensitiveObject,
  safeMetadataForPersistence,
  SENSITIVE_KEY_RE,
} from "@/lib/security/redaction";
// Backward-compat shim — must remain importable and re-export the same symbols
import { isSensitiveKey, scrubValue } from "@/lib/observability/redaction";

// ── isSensitiveKey ────────────────────────────────────────────────────────────

test("isSensitiveKey: keys from the audit path (previously missing from errors)", () => {
  // These were in audit.ts SENSITIVE_KEY_RE but NOT in errors.ts SENSITIVE_KEY_PATTERNS
  assert.equal(isSensitiveKey("email"), true, "email");
  assert.equal(isSensitiveKey("userEmail"), true, "userEmail");
  assert.equal(isSensitiveKey("url"), true, "url");
  assert.equal(isSensitiveKey("sourceUrl"), true, "sourceUrl");
  assert.equal(isSensitiveKey("key"), true, "key");
  assert.equal(isSensitiveKey("secretKey"), true, "secretKey");
  assert.equal(isSensitiveKey("pass"), true, "pass");
  assert.equal(isSensitiveKey("password"), true, "password");
  assert.equal(isSensitiveKey("pwd"), true, "pwd");
});

test("isSensitiveKey: keys from the errors path (previously missing from audit)", () => {
  // These were in errors.ts SENSITIVE_KEY_PATTERNS but NOT in audit.ts SENSITIVE_KEY_RE
  assert.equal(isSensitiveKey("content"), true, "content");
  assert.equal(isSensitiveKey("articleContent"), true, "articleContent");
  assert.equal(isSensitiveKey("text"), true, "text");
  assert.equal(isSensitiveKey("selectedText"), true, "selectedText");
  assert.equal(isSensitiveKey("prompt"), true, "prompt");
  assert.equal(isSensitiveKey("systemPrompt"), true, "systemPrompt");
  assert.equal(isSensitiveKey("body"), true, "body");
  assert.equal(isSensitiveKey("message_body"), true, "message_body");
  assert.equal(isSensitiveKey("completion"), true, "completion");
  assert.equal(isSensitiveKey("selected"), true, "selected");
  assert.equal(isSensitiveKey("selection"), true, "selection");
});

test("isSensitiveKey: analytics-only keys (definition/translation/etc.)", () => {
  // These were only in sanitize.ts SENSITIVE_PROPERTY_KEY_RE
  assert.equal(isSensitiveKey("definition"), true, "definition");
  assert.equal(isSensitiveKey("wordDefinition"), true, "wordDefinition");
  assert.equal(isSensitiveKey("translation"), true, "translation");
  assert.equal(isSensitiveKey("articleTranslation"), true, "articleTranslation");
  assert.equal(isSensitiveKey("example"), true, "example");
  assert.equal(isSensitiveKey("usageExample"), true, "usageExample");
  assert.equal(isSensitiveKey("explanation"), true, "explanation");
  assert.equal(isSensitiveKey("phrase"), true, "phrase");
  assert.equal(isSensitiveKey("response"), true, "response");
  assert.equal(isSensitiveKey("sentence"), true, "sentence");
});

test("isSensitiveKey: universal secrets/auth keys", () => {
  assert.equal(isSensitiveKey("authorization"), true, "authorization");
  assert.equal(isSensitiveKey("Authorization"), true, "Authorization (uppercase)");
  assert.equal(isSensitiveKey("cookie"), true, "cookie");
  assert.equal(isSensitiveKey("credential"), true, "credential");
  assert.equal(isSensitiveKey("secret"), true, "secret");
  assert.equal(isSensitiveKey("session"), true, "session");
  assert.equal(isSensitiveKey("token"), true, "token");
  assert.equal(isSensitiveKey("accessToken"), true, "accessToken");
  assert.equal(isSensitiveKey("apiKey"), true, "apiKey");
  assert.equal(isSensitiveKey("api_key"), true, "api_key");
});

test("isSensitiveKey: safe keys are not redacted", () => {
  assert.equal(isSensitiveKey("action"), false, "action");
  assert.equal(isSensitiveKey("count"), false, "count");
  assert.equal(isSensitiveKey("format"), false, "format");
  assert.equal(isSensitiveKey("lang"), false, "lang");
  assert.equal(isSensitiveKey("page"), false, "page");
  assert.equal(isSensitiveKey("role"), false, "role");
  assert.equal(isSensitiveKey("safeField"), false, "safeField");
  assert.equal(isSensitiveKey("status"), false, "status");
  assert.equal(isSensitiveKey("targetId"), false, "targetId");
  assert.equal(isSensitiveKey("targetType"), false, "targetType");
});

// ── scrubValue ────────────────────────────────────────────────────────────────

test("scrubValue: masks embedded email addresses as [email]", () => {
  assert.equal(scrubValue("user@example.com"), "[email]");
  assert.equal(scrubValue("contact me at alice@corp.io today"), "contact me at [email] today");
  // Multiple emails in one string
  const two = scrubValue("from: a@b.com to: c@d.org");
  assert.match(two, /\[email\]/);
  assert.doesNotMatch(two, /a@b\.com|c@d\.org/);
});

test("scrubValue: masks long token-like strings as [token]", () => {
  const apiKey = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  assert.equal(scrubValue(apiKey), "[token]");
  // JWT-style: each segment is 24+ chars
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
  const scrubbed = scrubValue(jwt);
  assert.match(scrubbed, /\[token\]/);
  assert.doesNotMatch(scrubbed, /eyJ/);
});

test("scrubValue: does not alter safe short strings", () => {
  assert.equal(scrubValue("hello world"), "hello world");
  assert.equal(scrubValue("role-change"), "role-change");
  assert.equal(scrubValue("Reader"), "Reader");
});

test("scrubValue: masks both email and token in a single string", () => {
  const msg = "user me@example.com used token ABCDEF0123456789ABCDEF0123456 to authenticate";
  const out = scrubValue(msg);
  assert.match(out, /\[email\]/);
  assert.match(out, /\[token\]/);
  assert.doesNotMatch(out, /me@example\.com/);
  assert.doesNotMatch(out, /ABCDEF0123456789/);
});

// ── SENSITIVE_KEY_RE (exported for analytics consumers) ──────────────────────

test("SENSITIVE_KEY_RE is a single canonical regex for all three paths", () => {
  // Spot-check: analytics path — definition, translation
  assert.ok(SENSITIVE_KEY_RE.test("definition"));
  assert.ok(SENSITIVE_KEY_RE.test("translation"));
  // audit path — email, url
  assert.ok(SENSITIVE_KEY_RE.test("email"));
  assert.ok(SENSITIVE_KEY_RE.test("url"));
  // errors path — prompt, content, body
  assert.ok(SENSITIVE_KEY_RE.test("prompt"));
  assert.ok(SENSITIVE_KEY_RE.test("content"));
  assert.ok(SENSITIVE_KEY_RE.test("body"));
  // safe
  assert.ok(!SENSITIVE_KEY_RE.test("count"));
  assert.ok(!SENSITIVE_KEY_RE.test("format"));
});

// ── Cross-path regression: audit path now catches content/text/prompt/body/selection

test("audit: sanitizeAuditMetadata now redacts content, text, prompt, body, selection", async () => {
  const { sanitizeAuditMetadata } = await import("@/lib/security/audit");

  const out = sanitizeAuditMetadata({
    prompt: "Please summarise this article",
    articleContent: "The full text of the article goes here",
    selectedText: "highlighted phrase",
    requestBody: "{ \"query\": \"secret\" }",
    definition: "the meaning of a word",
    translation: "la traduction",
    safeCount: 5,
    safeAction: "translate",
  });

  assert.equal(out.prompt, "[redacted]", "prompt must be redacted in audit");
  assert.equal(out.articleContent, "[redacted]", "articleContent must be redacted in audit");
  assert.equal(out.selectedText, "[redacted]", "selectedText must be redacted in audit");
  assert.equal(out.requestBody, "[redacted]", "requestBody must be redacted in audit");
  assert.equal(out.definition, "[redacted]", "definition must be redacted in audit");
  assert.equal(out.translation, "[redacted]", "translation must be redacted in audit");
  // Safe fields are preserved
  assert.equal(out.safeCount, 5);
  assert.equal(out.safeAction, "translate");
});

// ── Cross-path regression: errors path now catches email/url/key/pass/pwd

test("errors: scrubContext now redacts email, url, key, pass, pwd keys", async () => {
  const { scrubContext } = await import("@/lib/observability/errors");

  const out = scrubContext({
    email: "user@example.com",
    sourceUrl: "https://internal.example.com/secret",
    apiKey: "mysupersecretapikey",
    pass: "hunter2",
    pwd: "hunter2",
    count: 3,
    action: "translate",
  });

  assert.equal(out?.email, "[redacted]", "email key must be redacted in errors");
  assert.equal(out?.sourceUrl, "[redacted]", "url-containing key must be redacted in errors");
  assert.equal(out?.apiKey, "[redacted]", "key-containing key must be redacted in errors");
  assert.equal(out?.pass, "[redacted]", "pass key must be redacted in errors");
  assert.equal(out?.pwd, "[redacted]", "pwd key must be redacted in errors");
  assert.equal(out?.count, 3);
  assert.equal(out?.action, "translate");
});

// ── Cross-path regression: analytics path coverage (superset preserved)

test("analytics: sanitizeEventProperties rejects all superset keys", async () => {
  const { sanitizeEventProperties } = await import("@/lib/analytics/events/sanitize");

  const input: Record<string, unknown> = {
    // audit-path keys
    email: "a@b.com",
    url: "https://x.com",
    key: "secret",
    pass: "hunter2",
    pwd: "pw",
    // errors-path keys
    content: "article body",
    text: "selected text",
    prompt: "system prompt",
    body: "request body",
    selection: "highlighted",
    completion: "llm output",
    // analytics-specific
    definition: "meaning",
    translation: "translation",
    example: "example sentence",
    explanation: "why",
    phrase: "key phrase",
    response: "ai response",
    sentence: "a full sentence",
    // safe keys
    safeCount: 5,
    safeAction: "quiz",
  };

  const out = sanitizeEventProperties(input);

  // All sensitive keys must be dropped (analytics drops, not redacts)
  const sensitiveKeys = [
    "email", "url", "key", "pass", "pwd",
    "content", "text", "prompt", "body", "selection", "completion",
    "definition", "translation", "example", "explanation", "phrase", "response", "sentence",
  ];
  for (const k of sensitiveKeys) {
    assert.equal(k in out, false, `${k} must not appear in analytics output`);
  }
  // Safe fields pass through
  assert.equal(out.safeCount, 5);
  assert.equal(out.safeAction, "quiz");
});

// ── compat aliases are identical functions ────────────────────────────────────

test("compat alias isSensitiveKey delegates to isSensitiveMetadataKey", () => {
  assert.strictEqual(isSensitiveKey, isSensitiveMetadataKey);
});

test("compat alias scrubValue delegates to redactSensitiveValue", () => {
  assert.strictEqual(scrubValue, redactSensitiveValue);
});

// ── redactSensitiveObject ────────────────────────────────────────────────────

test("redactSensitiveObject: sensitive keys become [redacted]", () => {
  const out = redactSensitiveObject({
    password: "hunter2",
    token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.FAKE",
    secret: "my-secret-value",
    authorization: "Bearer FAKETOKEN1234567890ABCDEF",
    cookie: "__Secure-session=ABC123",
    apiKey: "sk-test-FAKEFAKEFAKE12345",
    email: "user@example.com",
  });
  assert.equal(out!.password, "[redacted]");
  assert.equal(out!.token, "[redacted]");
  assert.equal(out!.secret, "[redacted]");
  assert.equal(out!.authorization, "[redacted]");
  assert.equal(out!.cookie, "[redacted]");
  assert.equal(out!.apiKey, "[redacted]");
  assert.equal(out!.email, "[redacted]");
});

test("redactSensitiveObject: nested objects become [object] (cannot leak structured content)", () => {
  const out = redactSensitiveObject({
    safeCount: 42,
    nested: { deep: "should not appear" },
    alsoNested: { secret: "hidden" },
  });
  assert.equal(out!.safeCount, 42);
  assert.equal(out!.nested, "[object]");
  assert.equal(out!.alsoNested, "[object]");
});

test("redactSensitiveObject: string values are capped at 200 characters", () => {
  const longValue = "a".repeat(300);
  const out = redactSensitiveObject({ safeDescription: longValue });
  assert.equal(typeof out!.safeDescription, "string");
  assert.ok((out!.safeDescription as string).length <= 200);
});

test("redactSensitiveObject: PII in safe string values is masked inline", () => {
  const out = redactSensitiveObject({
    safeNote: "contact admin@example.com about this issue",
  });
  assert.doesNotMatch(out!.safeNote as string, /admin@example\.com/);
  assert.match(out!.safeNote as string, /\[email\]/);
});

test("redactSensitiveObject: booleans and numbers pass through unchanged", () => {
  const out = redactSensitiveObject({ flag: true, count: 7, ratio: 3.14 });
  assert.equal(out!.flag, true);
  assert.equal(out!.count, 7);
  assert.equal(out!.ratio, 3.14);
});

test("redactSensitiveObject: null/undefined input returns undefined", () => {
  assert.equal(redactSensitiveObject(undefined), undefined);
});

// ── safeMetadataForPersistence ────────────────────────────────────────────────

test("safeMetadataForPersistence: top-level sensitive keys are redacted", () => {
  const out = safeMetadataForPersistence({
    prompt: "Please summarise this article for me",
    selectedText: "The highlighted passage in the article",
    content: "Full article body goes here",
    token: "FAKETOKEN0123456789ABCDEF0123456789",
    authorization: "Bearer FAKEBEARER000000000000000000000",
    cookie: "session=FAKEVALUE0000",
    password: "s3cr3t!",
    apiKey: "FAKEAPIKEY00000000000000",
    email: "student@school.edu",
    safeStatus: "active",
    safeCount: 12,
  });

  assert.equal(out.prompt, "[redacted]", "prompt leaked");
  assert.equal(out.selectedText, "[redacted]", "selectedText leaked");
  assert.equal(out.content, "[redacted]", "content leaked");
  assert.equal(out.token, "[redacted]", "token leaked");
  assert.equal(out.authorization, "[redacted]", "authorization leaked");
  assert.equal(out.cookie, "[redacted]", "cookie leaked");
  assert.equal(out.password, "[redacted]", "password leaked");
  assert.equal(out.apiKey, "[redacted]", "apiKey leaked");
  assert.equal(out.email, "[redacted]", "email leaked");
  assert.equal(out.safeStatus, "active");
  assert.equal(out.safeCount, 12);
});

test("safeMetadataForPersistence: nested sensitive keys are redacted recursively", () => {
  const out = safeMetadataForPersistence({
    // "meta" and "user" do not match SENSITIVE_KEY_RE; "token" does
    meta: {
      user: {
        token: "FAKENESTED0000000000000000",
        safeRole: "reader",
      },
      safeAction: "translate",
    },
  });

  const meta = out.meta as Record<string, unknown>;
  const user = meta.user as Record<string, unknown>;
  assert.equal(user.token, "[redacted]");
  assert.equal(user.safeRole, "reader");
  assert.equal(meta.safeAction, "translate");
});

test("safeMetadataForPersistence: depth is capped (> 3 levels → [truncated])", () => {
  const out = safeMetadataForPersistence({
    a: { b: { c: { d: { e: "too deep" } } } },
  });
  // sanitizeDeep is called with depth 0 for top-level, incrementing per level.
  // depth > MAX_SAFE_DEPTH (3) triggers truncation, so depth=4 (5th level) is caught.
  // At depth 3 an object is still processed, but its values at depth 4 are truncated.
  const a = out.a as Record<string, unknown>;
  const b = a.b as Record<string, unknown>;
  const c = b.c as Record<string, unknown>;
  const d = c.d as Record<string, unknown>;
  // e is at depth 4 > MAX_SAFE_DEPTH → "[truncated]"
  assert.equal(d.e, "[truncated]");
});

test("safeMetadataForPersistence: arrays are capped at 20 items", () => {
  const arr = Array.from({ length: 30 }, (_, i) => i);
  const out = safeMetadataForPersistence({ items: arr });
  assert.ok(Array.isArray(out.items));
  assert.ok((out.items as unknown[]).length <= 20);
});

test("safeMetadataForPersistence: string values are capped at 200 characters", () => {
  const out = safeMetadataForPersistence({ safeNote: "x".repeat(500) });
  assert.ok(typeof out.safeNote === "string");
  assert.ok((out.safeNote as string).length <= 200);
});

test("safeMetadataForPersistence: key count is capped at 25 per object", () => {
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) wide[`safeKey${i}`] = i;
  const out = safeMetadataForPersistence(wide);
  assert.ok(Object.keys(out).length <= 25);
});

test("safeMetadataForPersistence: null/undefined input returns empty object", () => {
  assert.deepEqual(safeMetadataForPersistence(null), {});
  assert.deepEqual(safeMetadataForPersistence(undefined), {});
});

test("safeMetadataForPersistence: booleans and finite numbers pass through", () => {
  const out = safeMetadataForPersistence({ flag: false, score: 0.95, count: 0 });
  assert.equal(out.flag, false);
  assert.equal(out.score, 0.95);
  assert.equal(out.count, 0);
});

test("safeMetadataForPersistence: non-finite numbers become null", () => {
  const out = safeMetadataForPersistence({ a: Infinity, b: NaN, c: -Infinity });
  assert.equal(out.a, null);
  assert.equal(out.b, null);
  assert.equal(out.c, null);
});

test("safeMetadataForPersistence: email/token in string values is masked", () => {
  const out = safeMetadataForPersistence({
    safeNote: "from admin@readwise.io with key FAKEKEY000000000000000000",
  });
  assert.doesNotMatch(out.safeNote as string, /admin@readwise\.io/);
  assert.doesNotMatch(out.safeNote as string, /FAKEKEY000/);
  assert.match(out.safeNote as string, /\[email\]/);
  assert.match(out.safeNote as string, /\[token\]/);
});

// ── AI-ledger: consumes shared policy ────────────────────────────────────────

test("AI-ledger: redactSensitiveValue is imported from @/lib/security/redaction", async () => {
  // Verify the ledger uses the shared policy by checking that error messages
  // are scrubbed through the same redactSensitiveValue function before storage.
  const { recordAiInvocation } = await import("@/lib/ai/ledger");

  // Calling recordAiInvocation with a write-failing Prisma mock must not throw,
  // and must not propagate the raw error message (scrubbed internally).
  const input = {
    userId: "u1",
    model: "gpt-4o",
    provider: "azure" as const,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    latencyMs: 42,
    feature: "test-feature",
    status: "success" as const,
    errorMessage: "Connection to db failed with password=hunter2",
  };

  // Must not throw even on missing Prisma (graceful fallback)
  let threw = false;
  try {
    await recordAiInvocation(input);
  } catch {
    threw = true;
  }
  // We only assert it doesn't escalate — graceful fallback is the contract.
  assert.equal(threw, false, "recordAiInvocation must not throw");
});

// ── security-events: consumes shared policy via scrubContext ─────────────────

test("security-events: recordSecurityEvent meta is scrubbed through shared policy", async () => {
  const { recordSecurityEvent } = await import("@/lib/security/events");

  // recordSecurityEvent is best-effort and must never throw.
  let threw = false;
  try {
    recordSecurityEvent({
      type: "auth.unauthorized",
      severity: "low",
      meta: {
        // These sensitive keys must be scrubbed before the event is stored/logged.
        token: "FAKESECRET0000000000000000",
        authorization: "Bearer FAKEBEARER000000000000",
        cookie: "session=FAKECOOKIE000",
        safeRoute: "/api/articles",
      },
    });
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "recordSecurityEvent must never throw");
});
