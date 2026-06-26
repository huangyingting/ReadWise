/**
 * Unified redaction primitive tests (R2CI-1 / #627).
 *
 * Verifies that the shared primitive in src/lib/observability/redaction.ts
 * covers the superset of all three prior per-module key lists, and that each
 * consuming path (audit, errors, analytics) correctly redacts keys that the
 * other paths previously missed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveKey, scrubValue, SENSITIVE_KEY_RE } from "@/lib/observability/redaction";

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
