/**
 * Narration source order: preferred engine first, then the other; cloud
 * errors defer to on-device and surface only when no audio was found.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNarrationSource } from "@/components/reader/narrationSource";

function attempts(device: boolean | Error, cloud: boolean | Error) {
  const calls: string[] = [];
  const run = (name: string, result: boolean | Error) => async () => {
    calls.push(name);
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, attempts: { device: run("device", device), cloud: run("cloud", cloud) } };
}

test("uses the preferred engine when it has audio", async () => {
  const device = attempts(true, true);
  assert.equal(await loadNarrationSource("device", device.attempts), "device");
  assert.deepEqual(device.calls, ["device"]);

  const cloud = attempts(true, true);
  assert.equal(await loadNarrationSource("cloud", cloud.attempts), "cloud");
  assert.deepEqual(cloud.calls, ["cloud"]);
});

test("falls back to the other engine", async () => {
  const noCloudFile = attempts(true, false);
  assert.equal(await loadNarrationSource("cloud", noCloudFile.attempts), "device");
  assert.deepEqual(noCloudFile.calls, ["cloud", "device"]);

  const deviceFailed = attempts(false, true);
  assert.equal(await loadNarrationSource("device", deviceFailed.attempts), "cloud");
  assert.deepEqual(deviceFailed.calls, ["device", "cloud"]);
});

test("returns null when neither engine has audio", async () => {
  assert.equal(await loadNarrationSource("device", attempts(false, false).attempts), null);
  assert.equal(await loadNarrationSource("cloud", attempts(false, false).attempts), null);
});

test("a cloud error defers to on-device and surfaces only if on-device also fails", async () => {
  const rateLimited = new Error("HTTP 429");
  assert.equal(await loadNarrationSource("cloud", attempts(true, rateLimited).attempts), "device");
  await assert.rejects(() => loadNarrationSource("cloud", attempts(false, rateLimited).attempts), /HTTP 429/);
  await assert.rejects(() => loadNarrationSource("device", attempts(false, rateLimited).attempts), /HTTP 429/);
});

test("on-device errors are not swallowed", async () => {
  await assert.rejects(() => loadNarrationSource("device", attempts(new Error("bug"), true).attempts), /bug/);
});
