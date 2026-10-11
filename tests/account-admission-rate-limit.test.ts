import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

const consumed: Array<{ key: string; scope: string }> = [];

before(() => {
  mock.module("@/lib/security/rate-limit", {
    namedExports: {
      checkRateLimitByKey: async (key: string, scope: string) => {
        consumed.push({ key, scope });
      },
      clientIpKey: () => "ip:203.0.113.10",
    },
  });
});

beforeEach(() => {
  consumed.length = 0;
});

test("account admission throttles by IP and a non-reversible email key", async () => {
  const { enforceAccountAdmissionRateLimit } = await import(
    "@/lib/account-admission/rate-limit"
  );

  await enforceAccountAdmissionRateLimit(
    new Request("https://readwise.example/api/auth/register"),
    " Reader@Example.com ",
  );

  assert.equal(consumed.length, 2);
  assert.deepEqual(consumed[0], { key: "ip:203.0.113.10", scope: "auth" });
  assert.equal(consumed[1]?.scope, "auth");
  assert.match(consumed[1]?.key ?? "", /^email:[A-Za-z0-9_-]{43}$/);
  assert.equal(consumed[1]?.key.includes("reader@example.com"), false);
});
