/**
 * Tests for src/lib/media-blob.ts (REF-030).
 *
 * base64ToBlobUrl and revokeBlobUrl are pure helpers that rely on Web APIs
 * (atob, Blob, URL.createObjectURL, URL.revokeObjectURL).  We shim the
 * missing browser globals so the tests run in Node.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Browser API shims
// ---------------------------------------------------------------------------

let revokedUrls: string[] = [];
let objectUrlCounter = 0;

before(() => {
  URL.createObjectURL = (blob: Blob) => {
    objectUrlCounter += 1;
    return `blob:test-${objectUrlCounter}-${blob.type}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revokedUrls.push(url);
  };
});

after(() => {
  // Restore to satisfy any subsequent tests that also need these APIs.
  URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = undefined as unknown as typeof URL.revokeObjectURL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringToBase64(text: string): string {
  return Buffer.from(text).toString("base64");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("base64ToBlobUrl", () => {
  test("converts a plain base64 string to a Blob URL", async () => {
    const { base64ToBlobUrl } = await import("@/lib/media-blob");
    const b64 = stringToBase64("hello audio");
    const url = base64ToBlobUrl(b64, "audio/mpeg");
    assert.ok(url.startsWith("blob:"), `expected blob: URL, got: ${url}`);
    assert.ok(url.includes("audio/mpeg"), `expected mimeType in URL, got: ${url}`);
  });

  test("strips the data-URI header before decoding", async () => {
    const { base64ToBlobUrl } = await import("@/lib/media-blob");
    const b64 = stringToBase64("hello data-uri audio");
    const dataUri = `data:audio/mpeg;base64,${b64}`;
    const url = base64ToBlobUrl(dataUri, "audio/mpeg");
    assert.ok(url.startsWith("blob:"), `expected blob: URL, got: ${url}`);
  });

  test("returns different URLs on successive calls (new Blob each time)", async () => {
    const { base64ToBlobUrl } = await import("@/lib/media-blob");
    const b64 = stringToBase64("data");
    const url1 = base64ToBlobUrl(b64, "audio/mpeg");
    const url2 = base64ToBlobUrl(b64, "audio/mpeg");
    assert.notEqual(url1, url2);
  });
});

describe("revokeBlobUrl", () => {
  test("calls URL.revokeObjectURL for a real URL string", async () => {
    const { revokeBlobUrl } = await import("@/lib/media-blob");
    revokedUrls = [];
    revokeBlobUrl("blob:test-999");
    assert.deepEqual(revokedUrls, ["blob:test-999"]);
  });

  test("is a no-op for null", async () => {
    const { revokeBlobUrl } = await import("@/lib/media-blob");
    revokedUrls = [];
    revokeBlobUrl(null);
    assert.deepEqual(revokedUrls, []);
  });

  test("is a no-op for undefined", async () => {
    const { revokeBlobUrl } = await import("@/lib/media-blob");
    revokedUrls = [];
    revokeBlobUrl(undefined);
    assert.deepEqual(revokedUrls, []);
  });

  test("is a no-op for empty string", async () => {
    const { revokeBlobUrl } = await import("@/lib/media-blob");
    revokedUrls = [];
    revokeBlobUrl("");
    assert.deepEqual(revokedUrls, []);
  });
});
