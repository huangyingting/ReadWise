import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchNarrationTextBasis,
  prepareNarrationText,
  REALTIME_NARRATION_TEXT_BASIS,
  resolveStoredNarrationTextBasis,
} from "@/lib/speech/text-basis";

test("prepareNarrationText preserves full Reader text and block order", () => {
  const basis = batchNarrationTextBasis(null);

  assert.deepEqual(
    prepareNarrationText("<p>First paragraph.</p><p>Second paragraph.</p>", basis),
    {
      plainText: "First paragraph. Second paragraph.",
      blocks: ["First paragraph.", "Second paragraph."],
      basis: { kind: "full" },
    },
  );
});

test("prepareNarrationText applies the real-time character limit", () => {
  const content = `<p>${"a".repeat(5_001)}</p>`;
  const result = prepareNarrationText(content, REALTIME_NARRATION_TEXT_BASIS);

  assert.equal(result.plainText.length, 5_000);
  assert.deepEqual(result.basis, { kind: "character-limit", maxChars: 5_000 });
});

test("prepareNarrationText replays the Batch paragraph limit", () => {
  const basis = batchNarrationTextBasis(20);

  assert.deepEqual(
    prepareNarrationText("<p>First paragraph.</p><p>Second paragraph.</p>", basis),
    {
      plainText: "First paragraph. Seco",
      blocks: ["First paragraph.", "Seco"],
      basis: { kind: "paragraph-limit", maxChars: 20 },
    },
  );
});

test("resolveStoredNarrationTextBasis preserves legacy provider behavior", () => {
  assert.deepEqual(resolveStoredNarrationTextBasis(undefined, "azure-batch"), {
    kind: "full",
  });
  assert.deepEqual(resolveStoredNarrationTextBasis(undefined, "azure"), {
    kind: "character-limit",
    maxChars: 5_000,
  });
});