/**
 * Unit tests for deterministic lesson helpers (#1304): oral fluency passages,
 * fluency scoring, and fallback scaffolds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLUENCY_LENGTHS,
  FLUENCY_RUBRIC,
  accuracyBand,
  extractFluencyPassage,
  fluencyAccuracy,
  isFluencyLength,
  parseFluencyLength,
  wordsCorrectPerMinute,
} from "@/lib/lesson/fluency";
import { deterministicLessonScaffold, extractKeyTerms } from "@/lib/lesson/scaffold-fallback";

const words = (n: number, end = ".") => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ") + end;

test("fluency passages stop exactly at the target with cumulative line counts", () => {
  assert.deepEqual(FLUENCY_LENGTHS, [100, 150, 200]);
  const text = `${words(30)}\n\n${words(200)}`;
  for (const target of FLUENCY_LENGTHS) {
    const passage = extractFluencyPassage(text, target);
    assert.equal(passage.wordCount, target);
    assert.equal(passage.lines.at(-1)?.cumulative, target);
    assert.ok(passage.lines.every((line) => line.text.split(" ").length <= 12));
    assert.equal(passage.truncated, true);
  }
  const first = extractFluencyPassage(text, 100);
  assert.deepEqual(first.lines.slice(0, 3).map((line) => line.cumulative), [12, 24, 30], "lines break at paragraphs");
  assert.deepEqual(extractFluencyPassage(text, 150), extractFluencyPassage(text, 150), "deterministic");
});

test("short articles yield the whole text; sentence-final passages aren't truncated", () => {
  const short = extractFluencyPassage("One two three.", 100);
  assert.deepEqual(short, { target: 100, wordCount: 3, lines: [{ text: "One two three.", cumulative: 3 }], truncated: false });
  assert.equal(extractFluencyPassage(words(100, "."), 100).truncated, false);
  assert.equal(extractFluencyPassage("", 150).wordCount, 0);
});

test("fluency lengths parse and scores compute", () => {
  assert.equal(isFluencyLength(150), true);
  assert.equal(isFluencyLength("200"), true);
  assert.equal(isFluencyLength(120), false);
  assert.equal(parseFluencyLength("150"), 150);
  assert.equal(parseFluencyLength(["200"]), 200);
  assert.equal(parseFluencyLength("x"), 100);
  assert.equal(wordsCorrectPerMinute(110, 4), 106);
  assert.equal(wordsCorrectPerMinute(55, 5, 30), 100);
  assert.equal(wordsCorrectPerMinute(0, 0), 0);
  assert.equal(fluencyAccuracy(100, 3), 97);
  assert.equal(fluencyAccuracy(0, 0), 0);
  assert.equal(accuracyBand(97), "independent");
  assert.equal(accuracyBand(92), "instructional");
  assert.equal(accuracyBand(80), "frustration");
  assert.equal(FLUENCY_RUBRIC.prosody.length, 4);
});

test("fallback scaffolds pick frequent long terms with context", () => {
  const text =
    "Scientists studied coral restoration in Florida. Coral restoration needs volunteers. " +
    "The NOAA program trains volunteers. However, temperatures keep rising everywhere.";
  const terms = extractKeyTerms(text);
  assert.deepEqual(terms.map((term) => term.term).slice(0, 2), ["restoration", "volunteers"]);
  assert.equal(terms[0].context, "Scientists studied coral restoration in Florida.");
  assert.equal(terms[0].definition, null);
  assert.ok(!terms.some((term) => term.term === "however"));

  const scaffold = deterministicLessonScaffold("Reefs Rebound", text);
  assert.match(scaffold.hook, /restoration/);
  assert.equal(scaffold.questions.length, 5);
  assert.match(scaffold.questions[0], /Reefs Rebound/);
  assert.match(deterministicLessonScaffold("Tiny", "Hi.").hook, /predict/);
  assert.ok(extractKeyTerms(`Wonderful ${"x".repeat(300)}longwordhere.`)[0].context!.endsWith("…"));
  assert.equal(extractKeyTerms("WIKIPEDIA editors agree. WIKIPEDIA grows.")[0].term, "WIKIPEDIA", "acronyms keep their case");
  assert.equal(extractKeyTerms("We met Florence Nightingale. Nightingale nursed soldiers.")[0].term, "Nightingale", "names keep their case");
  assert.equal(extractKeyTerms("Vaccines work. Doctors trust vaccines. Vaccines help.")[0].term, "vaccines", "common nouns are lowercased");
});
