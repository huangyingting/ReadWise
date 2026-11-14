/**
 * Entra ID token providers for batch TTS: credential selection, prompt
 * wiring, and token caching until shortly before expiry.
 */
import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

type Token = { token: string; expiresOnTimestamp: number } | null;

let created: Array<{ kind: string; options: Record<string, unknown> }> = [];
let tokens: Token[] = [];
let scopes: string[] = [];

class FakeCredential {
  constructor(kind: string, options: Record<string, unknown>) {
    created.push({ kind, options });
  }
  async getToken(scope: string): Promise<Token> {
    scopes.push(scope);
    return tokens.shift() ?? null;
  }
}

before(() => {
  mock.module("@azure/identity", {
    namedExports: {
      AzureCliCredential: class extends FakeCredential {
        constructor(options: Record<string, unknown>) {
          super("cli", options);
        }
      },
      DeviceCodeCredential: class extends FakeCredential {
        constructor(options: Record<string, unknown>) {
          super("device", options);
        }
      },
    },
  });
});

beforeEach(() => {
  created = [];
  tokens = [];
  scopes = [];
});

const HOUR = 60 * 60 * 1000;

test("CLI mode reuses the az login session for the tenant and caches tokens", async () => {
  const { COGNITIVE_SERVICES_SCOPE, createEntraTokenProvider } = await import("@/lib/speech/entra-auth");
  tokens = [{ token: "t1", expiresOnTimestamp: Date.now() + HOUR }];
  const getToken = await createEntraTokenProvider({ mode: "cli", tenantId: "tenant-1" });

  assert.equal(await getToken(), "t1");
  assert.equal(await getToken(), "t1");
  assert.deepEqual(created, [{ kind: "cli", options: { tenantId: "tenant-1" } }]);
  assert.deepEqual(scopes, [COGNITIVE_SERVICES_SCOPE]);
});

test("refreshes tokens within five minutes of expiry", async () => {
  const { createEntraTokenProvider } = await import("@/lib/speech/entra-auth");
  tokens = [
    { token: "expiring", expiresOnTimestamp: Date.now() + 60_000 },
    { token: "fresh", expiresOnTimestamp: Date.now() + HOUR },
  ];
  const getToken = await createEntraTokenProvider({ mode: "cli", tenantId: "t" });
  assert.equal(await getToken(), "expiring");
  assert.equal(await getToken(), "fresh");
  assert.equal(scopes.length, 2);
});

test("device mode passes tenant, optional client id, and prompt callback", async (t) => {
  const { createEntraTokenProvider } = await import("@/lib/speech/entra-auth");
  const errors: string[] = [];
  t.mock.method(console, "error", (message: string) => errors.push(message));

  await createEntraTokenProvider({ mode: "device", tenantId: "t" });
  const defaultPrompt = created[0]!.options.userPromptCallback as (info: unknown) => void;
  assert.deepEqual(Object.keys(created[0]!.options).sort(), ["tenantId", "userPromptCallback"]);
  defaultPrompt({ verificationUri: "https://login.example/device", userCode: "ABC123", message: "m" });
  assert.deepEqual(errors, ["Entra ID: open https://login.example/device and enter code ABC123"]);

  const prompt = () => {};
  await createEntraTokenProvider({ mode: "device", tenantId: "t", clientId: "client-1", prompt });
  assert.equal(created[1]!.options.clientId, "client-1");
  assert.equal(created[1]!.options.userPromptCallback, prompt);
});

test("rejects when the credential returns no token", async () => {
  const { createEntraTokenProvider } = await import("@/lib/speech/entra-auth");
  const getToken = await createEntraTokenProvider({ mode: "cli", tenantId: "t" });
  await assert.rejects(getToken, /did not return an access token/);
});
