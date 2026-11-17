/**
 * Unit tests for the client-safe Write Prompt helpers (#1305).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INDEPENDENT_WRITE_SCOPE,
  RUBRIC_MAX_SCORE,
  WRITE_RUBRIC,
  WRITE_STATUS_LABELS,
  countWords,
  defaultWritePrompt,
  rubricTotal,
  sanitizeRubricScores,
} from "@/lib/classroom/writing-rubric";

test("the rubric has four 1–4 dimensions and labelled statuses", () => {
  assert.deepEqual(
    WRITE_RUBRIC.map((dimension) => dimension.key),
    ["claim", "evidence", "organization", "language"],
  );
  assert.equal(RUBRIC_MAX_SCORE, 4);
  assert.equal(WRITE_STATUS_LABELS.NEEDS_REVISION, "Needs revision");
  assert.equal(INDEPENDENT_WRITE_SCOPE, "independent");
});

test("countWords splits on any whitespace", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n\t "), 0);
  assert.equal(countWords("One"), 1);
  assert.equal(countWords("  The author argues,\nclearly. "), 4);
});

test("defaultWritePrompt names the article", () => {
  assert.match(defaultWritePrompt("Coral Reefs"), /“Coral Reefs”/);
  assert.match(defaultWritePrompt("X"), /two details from the article/);
});

test("sanitizeRubricScores keeps whole in-range scores for known dimensions", () => {
  assert.deepEqual(
    sanitizeRubricScores({ claim: 4, evidence: 0, organization: 2.5, language: "3", extra: 2 }),
    { claim: 4 },
  );
  assert.deepEqual(sanitizeRubricScores({ claim: 1, evidence: 2, organization: 3, language: 4 }), {
    claim: 1,
    evidence: 2,
    organization: 3,
    language: 4,
  });
  for (const value of [null, undefined, "x", [1, 2], 3]) {
    assert.deepEqual(sanitizeRubricScores(value), {});
  }
});

test("rubricTotal sums scored dimensions against the full rubric", () => {
  assert.deepEqual(rubricTotal({}), { total: 0, max: 16 });
  assert.deepEqual(rubricTotal({ claim: 3, language: 4 }), { total: 7, max: 16 });
});
