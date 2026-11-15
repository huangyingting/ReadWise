/**
 * Request-level Azure AI Services auth: Azure OpenAI sends `api-key` in key
 * mode and a bearer token in entra mode; Speech STS tokens come from the
 * regional host with the key, or the custom domain with a bearer token.
 * The access-token cache is mocked; `fetch` is intercepted.
 */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, mock, test } from "node:test";

let tokenFails = false;

before(() => {
  mock.module("@/lib/azure/ai-token", {
    namedExports: {
      getAiServicesAccessToken: async () => {
        if (tokenFails) throw new Error("token unavailable");
        return "aad-token";
      },
    },
  });
});

const KEYS = [
  "AZURE_AI_TENANT_ID",
  "AZURE_AI_CLIENT_ID",
  "AZURE_AI_CLIENT_SECRET",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_AUTH",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_ENDPOINT",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  tokenFails = false;
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.AZURE_OPENAI_ENDPOINT = "https://res.cognitiveservices.azure.com";
  process.env.AZURE_OPENAI_DEPLOYMENT = "gpt";
  process.env.AZURE_OPENAI_API_VERSION = "2025-01-01-preview";
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function captureFetch(t: { mock: typeof mock }, response: () => Response) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return response();
  });
  return calls;
}

function chatResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Azure OpenAI auth headers", () => {
  test("key mode sends api-key", async (t) => {
    const { AzureOpenAiProvider } = await import("@/lib/ai/azure-provider");
    process.env.AZURE_OPENAI_API_KEY = "k";
    const calls = captureFetch(t, chatResponse);
    const res = await new AzureOpenAiProvider().chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.ok, true);
    assert.equal(calls[0]!.headers["api-key"], "k");
    assert.equal(calls[0]!.headers.Authorization, undefined);
  });

  test("entra mode sends a bearer token and no key", async (t) => {
    const { AzureOpenAiProvider } = await import("@/lib/ai/azure-provider");
    process.env.AZURE_OPENAI_AUTH = "entra";
    process.env.AZURE_OPENAI_API_KEY = "ignored";
    process.env.AZURE_AI_TENANT_ID = "tenant";
    process.env.AZURE_AI_CLIENT_ID = "client";
    process.env.AZURE_AI_CLIENT_SECRET = "secret";
    const calls = captureFetch(t, chatResponse);
    const res = await new AzureOpenAiProvider().chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.ok, true);
    assert.equal(calls[0]!.headers.Authorization, "Bearer aad-token");
    assert.equal(calls[0]!.headers["api-key"], undefined);
  });

  test("a token failure becomes a provider error, not a throw", async (t) => {
    const { AzureOpenAiProvider } = await import("@/lib/ai/azure-provider");
    process.env.AZURE_OPENAI_AUTH = "entra";
    process.env.AZURE_AI_TENANT_ID = "tenant";
    process.env.AZURE_AI_CLIENT_ID = "client";
    process.env.AZURE_AI_CLIENT_SECRET = "secret";
    tokenFails = true;
    const calls = captureFetch(t, chatResponse);
    const res = await new AzureOpenAiProvider().chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0);
  });
});

describe("Speech authorization tokens", () => {
  const base = { region: "japaneast", voice: "v", format: "f" };

  test("key mode posts the key to the regional STS host", async (t) => {
    const { issueSpeechAuthorizationToken } = await import("@/lib/speech/authorization-token");
    const calls = captureFetch(t, () => new Response("sts-token", { status: 200 }));
    const token = await issueSpeechAuthorizationToken({ ...base, auth: "key", key: "speech-key" });
    assert.equal(token, "sts-token");
    assert.equal(calls[0]!.url, "https://japaneast.api.cognitive.microsoft.com/sts/v1.0/issueToken");
    assert.equal(calls[0]!.headers["Ocp-Apim-Subscription-Key"], "speech-key");
  });

  test("entra mode posts a bearer token to the custom-domain STS endpoint", async (t) => {
    const { issueSpeechAuthorizationToken } = await import("@/lib/speech/authorization-token");
    const calls = captureFetch(t, () => new Response("sts-token", { status: 200 }));
    const token = await issueSpeechAuthorizationToken({
      ...base,
      auth: "entra",
      endpoint: "https://res.cognitiveservices.azure.com",
    });
    assert.equal(token, "sts-token");
    assert.equal(calls[0]!.url, "https://res.cognitiveservices.azure.com/sts/v1.0/issueToken");
    assert.equal(calls[0]!.headers.Authorization, "Bearer aad-token");
    assert.equal(calls[0]!.headers["Ocp-Apim-Subscription-Key"], undefined);
  });

  test("rejects non-OK STS responses without exposing the body", async (t) => {
    const { issueSpeechAuthorizationToken } = await import("@/lib/speech/authorization-token");
    captureFetch(t, () => new Response("forbidden detail", { status: 403 }));
    await assert.rejects(
      () => issueSpeechAuthorizationToken({ ...base, auth: "key", key: "k" }),
      (err: unknown) => err instanceof Error && /HTTP 403/.test(err.message) && !/forbidden detail/.test(err.message),
    );
  });
});
