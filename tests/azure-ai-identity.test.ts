/**
 * Azure AI Services auth configuration: per-service auth mode, the shared
 * AZURE_AI_* Entra identity (service principal or managed identity),
 * certificate decoding, the AI/Speech configs, and readiness reporting.
 */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

const ENV_KEYS = [
  "AZURE_AI_CLIENT_CERTIFICATE",
  "AZURE_AI_CLIENT_ID",
  "AZURE_AI_CLIENT_SECRET",
  "AZURE_AI_TENANT_ID",
  "AZURE_AI_USE_MANAGED_IDENTITY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_AUTH",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_SPEECH_AUTH",
  "AZURE_SPEECH_ENDPOINT",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_OUTPUT_FORMAT",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_VOICE",
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIBfake\n-----END PRIVATE KEY-----\n-----BEGIN CERTIFICATE-----\nMIIBcert\n-----END CERTIFICATE-----\n";

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function setServicePrincipal(credential: "certificate" | "secret" = "certificate") {
  process.env.AZURE_AI_TENANT_ID = "tenant-1";
  process.env.AZURE_AI_CLIENT_ID = "client-1";
  if (credential === "certificate") {
    process.env.AZURE_AI_CLIENT_CERTIFICATE = Buffer.from(PEM).toString("base64");
  } else {
    process.env.AZURE_AI_CLIENT_SECRET = "s3cret";
  }
}

describe("auth mode and identity", () => {
  test("auth mode defaults to key and accepts entra case-insensitively", async () => {
    const { azureAuthMode } = await import("@/lib/runtime-config/azure-auth");
    assert.equal(azureAuthMode("AZURE_OPENAI_AUTH"), "key");
    process.env.AZURE_OPENAI_AUTH = "Entra";
    assert.equal(azureAuthMode("AZURE_OPENAI_AUTH"), "entra");
    process.env.AZURE_SPEECH_AUTH = "managed";
    assert.equal(azureAuthMode("AZURE_SPEECH_AUTH"), "key");
  });

  test("decodes base64, escaped, and raw PEMs that include a private key", async () => {
    const { decodeCertificatePem } = await import("@/lib/runtime-config/azure-auth");
    assert.equal(decodeCertificatePem(Buffer.from(PEM).toString("base64")), PEM);
    assert.equal(decodeCertificatePem(PEM.replace(/\n/g, "\\n")), PEM);
    assert.equal(decodeCertificatePem(PEM), PEM);
    assert.equal(decodeCertificatePem("-----BEGIN CERTIFICATE-----\nonly\n-----END CERTIFICATE-----"), null);
    assert.equal(decodeCertificatePem(Buffer.from("not a pem").toString("base64")), null);
  });

  test("resolves a service principal from a certificate or secret", async () => {
    const { aiServicesIdentity } = await import("@/lib/runtime-config/azure-auth");
    assert.equal(aiServicesIdentity.get(), null);
    process.env.AZURE_AI_TENANT_ID = "tenant-1";
    assert.equal(aiServicesIdentity.get(), null, "client id required");

    setServicePrincipal("certificate");
    assert.deepEqual(aiServicesIdentity.get(), {
      mode: "certificate",
      tenantId: "tenant-1",
      clientId: "client-1",
      certificatePem: PEM,
    });

    process.env.AZURE_AI_CLIENT_CERTIFICATE = "not-a-certificate";
    process.env.AZURE_AI_CLIENT_SECRET = "s3cret";
    assert.equal(aiServicesIdentity.get(), null, "an invalid certificate never falls back to the secret");

    delete process.env.AZURE_AI_CLIENT_CERTIFICATE;
    assert.deepEqual(aiServicesIdentity.get(), {
      mode: "secret",
      tenantId: "tenant-1",
      clientId: "client-1",
      clientSecret: "s3cret",
    });

    delete process.env.AZURE_AI_CLIENT_SECRET;
    assert.equal(aiServicesIdentity.get(), null, "a credential is required");
  });

  test("managed identity wins when enabled, with an optional user-assigned client id", async () => {
    const { aiServicesIdentity, aiServicesIdentityEnv } = await import("@/lib/runtime-config/azure-auth");
    process.env.AZURE_AI_USE_MANAGED_IDENTITY = "true";
    assert.deepEqual(aiServicesIdentity.get(), { mode: "managed-identity" });
    assert.deepEqual(aiServicesIdentityEnv(), ["AZURE_AI_USE_MANAGED_IDENTITY"]);
    process.env.AZURE_AI_CLIENT_ID = "mi-client";
    assert.deepEqual(aiServicesIdentity.get(), { mode: "managed-identity", clientId: "mi-client" });
  });

  test("reports the identity env slots in use", async () => {
    const { aiServicesIdentityEnv } = await import("@/lib/runtime-config/azure-auth");
    const base = ["AZURE_AI_TENANT_ID", "AZURE_AI_CLIENT_ID"];
    assert.deepEqual(aiServicesIdentityEnv(), [...base, "AZURE_AI_CLIENT_CERTIFICATE"]);
    process.env.AZURE_AI_CLIENT_SECRET = "s3cret";
    assert.deepEqual(aiServicesIdentityEnv(), [...base, "AZURE_AI_CLIENT_SECRET"]);
    process.env.AZURE_AI_CLIENT_CERTIFICATE = "x";
    assert.deepEqual(aiServicesIdentityEnv(), [...base, "AZURE_AI_CLIENT_CERTIFICATE"]);
  });
});

describe("service configs", () => {
  test("Azure OpenAI uses the key by default and the identity in entra mode", async () => {
    const { aiConfig } = await import("@/lib/runtime-config/ai");
    process.env.AZURE_OPENAI_ENDPOINT = "https://res.cognitiveservices.azure.com/";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt";
    process.env.AZURE_OPENAI_API_VERSION = "2025-01-01-preview";
    assert.equal(aiConfig.get(), null, "key mode needs a key");
    process.env.AZURE_OPENAI_API_KEY = "k";
    assert.deepEqual(aiConfig.get(), {
      endpoint: "https://res.cognitiveservices.azure.com",
      deployment: "gpt",
      apiVersion: "2025-01-01-preview",
      auth: "key",
      apiKey: "k",
    });

    process.env.AZURE_OPENAI_AUTH = "entra";
    assert.equal(aiConfig.get(), null, "entra mode needs an identity");
    setServicePrincipal();
    assert.deepEqual(aiConfig.get(), {
      endpoint: "https://res.cognitiveservices.azure.com",
      deployment: "gpt",
      apiVersion: "2025-01-01-preview",
      auth: "entra",
    });
  });

  test("Speech entra mode needs the custom-domain endpoint and an identity", async () => {
    const { speechConfig } = await import("@/lib/runtime-config/speech");
    process.env.AZURE_SPEECH_REGION = "japaneast";
    process.env.AZURE_SPEECH_AUTH = "entra";
    assert.equal(speechConfig.get(), null);
    process.env.AZURE_SPEECH_ENDPOINT = "https://res.cognitiveservices.azure.com/";
    assert.equal(speechConfig.get(), null);
    setServicePrincipal("secret");
    assert.deepEqual(speechConfig.get(), {
      region: "japaneast",
      voice: "en-US-AndrewMultilingualNeural",
      format: "audio-24khz-96kbitrate-mono-mp3",
      auth: "entra",
      endpoint: "https://res.cognitiveservices.azure.com",
    });
  });
});

describe("readiness reporting", () => {
  function setRequired() {
    process.env.DATABASE_URL = "file:./dev.db";
    process.env.NEXTAUTH_SECRET = "12345678901234567890123456789012";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
  }

  test("entra mode checks identity env instead of keys", async () => {
    const { validateRuntimeConfig } = await import("@/lib/runtime-config/runtime");
    setRequired();
    process.env.AZURE_OPENAI_AUTH = "entra";
    process.env.AZURE_OPENAI_ENDPOINT = "https://res.cognitiveservices.azure.com";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt";
    process.env.AZURE_OPENAI_API_VERSION = "2025-01-01-preview";
    process.env.AZURE_SPEECH_AUTH = "entra";
    process.env.AZURE_SPEECH_REGION = "japaneast";
    process.env.AZURE_SPEECH_ENDPOINT = "https://res.cognitiveservices.azure.com";

    let report = validateRuntimeConfig();
    assert.equal(report.optional.ai.status, "degraded");
    assert.ok(report.optional.ai.missing.includes("AZURE_AI_TENANT_ID"));
    assert.ok(!report.optional.ai.env.includes("AZURE_OPENAI_API_KEY"));

    setServicePrincipal();
    report = validateRuntimeConfig();
    assert.equal(report.optional.ai.status, "configured");
    assert.equal(report.optional.speech.status, "configured");
    assert.ok(report.optional.speech.env.includes("AZURE_SPEECH_ENDPOINT"));

    process.env.AZURE_AI_CLIENT_CERTIFICATE = "garbage";
    process.env.AZURE_SPEECH_ENDPOINT = "ftp://res.example";
    report = validateRuntimeConfig();
    assert.equal(report.optional.ai.status, "degraded");
    assert.ok(report.warnings.some((w) => w.code === "invalid_ai_client_certificate"));
    assert.ok(report.warnings.some((w) => w.env.includes("AZURE_SPEECH_ENDPOINT")));
  });
});
