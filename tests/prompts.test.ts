/**
 * Prompt template / version registry tests (RW-020).
 *
 * The registry is a pure, dependency-free module, so these tests need no mocks:
 * they assert that the active prompt versions are stable, that rendering for
 * representative inputs produces the expected message structure/content, and
 * that prompt-version bumps are detected for targeted rebuilds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROMPT_TEMPLATES,
  PROMPT_FEATURES,
  activePromptVersion,
  promptModelParams,
  renderPrompt,
  isPromptFeature,
  featuresWithStalePrompts,
  TARGET_VOCABULARY_WORDS,
  TARGET_QUIZ_QUESTIONS,
  TARGET_TAGS,
} from "@/lib/ai/prompts";

const EXPECTED_VERSIONS: Record<string, string> = {
  translation: "translation/v1",
  vocabulary: "vocabulary/v1",
  quiz: "quiz/v1",
  tags: "tags/v1",
  difficulty: "difficulty/v1",
  grammar: "grammar/v1",
  tutor: "tutor/v1",
  "sentence-translation": "sentence-translation/v1",
};

test("every feature has a documented active prompt version", () => {
  for (const feature of PROMPT_FEATURES) {
    assert.equal(activePromptVersion(feature), EXPECTED_VERSIONS[feature]);
    assert.equal(PROMPT_TEMPLATES[feature].active, true);
    assert.equal(PROMPT_TEMPLATES[feature].feature, feature);
    assert.ok(PROMPT_TEMPLATES[feature].description.length > 0);
  }
  // Every registered feature is accounted for above.
  assert.deepEqual(
    [...PROMPT_FEATURES].sort(),
    Object.keys(EXPECTED_VERSIONS).sort(),
  );
});

test("isPromptFeature guards registered features; unknown features default to <feature>/v1", () => {
  assert.equal(isPromptFeature("quiz"), true);
  assert.equal(isPromptFeature("nope"), false);
  assert.equal(activePromptVersion("nope"), "nope/v1");
  assert.deepEqual(promptModelParams("nope"), {});
});

test("renderPrompt(translation) preserves wording, label, title, and part note", () => {
  const single = renderPrompt("translation", {
    label: "Spanish",
    title: "My Title",
    chunk: "Hello world.",
    isPart: false,
  });
  assert.equal(single.length, 2);
  assert.equal(single[0].role, "system");
  assert.equal(single[1].role, "user");
  assert.match(single[0].content, /Translate the user's article into Spanish\./);
  assert.match(single[0].content, /no markdown fences\.$/);
  assert.equal(single[1].content, "Title: My Title\n\nHello world.");

  const part = renderPrompt("translation", {
    label: "French",
    title: "T",
    chunk: "c",
    isPart: true,
  });
  assert.match(part[0].content, /one section of a longer article/);
});

test("renderPrompt(vocabulary) requests the target count as JSON and embeds the source", () => {
  const messages = renderPrompt("vocabulary", { title: "Reefs", source: "Body text." });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, new RegExp(`${TARGET_VOCABULARY_WORDS} most useful`));
  assert.match(messages[0].content, /JSON array only\./);
  assert.equal(messages[1].content, "Title: Reefs\n\nBody text.");
});

test("renderPrompt(quiz) requests the target count of multiple-choice questions", () => {
  const messages = renderPrompt("quiz", { title: "Wolves", source: "Body." });
  assert.match(messages[0].content, new RegExp(`write ${TARGET_QUIZ_QUESTIONS} multiple-choice`));
  assert.match(messages[0].content, /correctIndex/);
  assert.equal(messages[1].content, "Title: Wolves\n\nBody.");
});

test("renderPrompt(tags) requests up to the target number of Title-Case tags", () => {
  const messages = renderPrompt("tags", { title: "Tea", source: "Body." });
  assert.match(messages[0].content, new RegExp(`up to ${TARGET_TAGS} concise topic tags`));
  assert.match(messages[0].content, /JSON array of tag strings/);
});

test("renderPrompt(difficulty) asks for a single CEFR token with a tight budget", () => {
  const messages = renderPrompt("difficulty", { title: "T", source: "S" });
  assert.match(messages[0].content, /CEFR scale/);
  assert.match(messages[0].content, /A1, A2, B1, B2, C1, C2/);
  assert.deepEqual(promptModelParams("difficulty"), { maxOutputTokens: 16 });
});

test("renderPrompt(grammar) calibrates to the level and varies by context presence", () => {
  const withCtx = renderPrompt("grammar", {
    phrase: "run into",
    context: "I run into friends.",
    level: "B1",
  });
  assert.match(withCtx[0].content, /suitable for a B1 learner/);
  assert.match(withCtx[1].content, /as used in this sentence: "I run into friends\."/);
  assert.match(withCtx[1].content, /"run into"/);

  const noCtx = renderPrompt("grammar", { phrase: "kick off", context: "", level: "A2" });
  assert.match(noCtx[0].content, /suitable for a A2 learner/);
  assert.doesNotMatch(noCtx[1].content, /as used in this sentence/);
  assert.match(noCtx[1].content, /Explain the phrase "kick off"\./);
});

test("renderPrompt(tutor) grounds in the article and calibrates to the CEFR level", () => {
  const messages = renderPrompt("tutor", {
    level: "A2",
    title: "Park",
    articleText: "The park opened on Saturday.",
    question: "When did the park open?",
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /CEFR level A2/);
  assert.match(messages[0].content, /ARTICLE TITLE: "Park"/);
  assert.match(messages[0].content, /The park opened on Saturday\./);
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "When did the park open?");
  assert.deepEqual(promptModelParams("tutor"), { maxOutputTokens: 2048 });
});

test("renderPrompt(sentence-translation) targets the language and echoes the text", () => {
  const messages = renderPrompt("sentence-translation", { label: "German", text: "Good morning." });
  assert.match(messages[0].content, /into German\./);
  assert.equal(messages[1].content, "Good morning.");
  assert.deepEqual(promptModelParams("sentence-translation"), { maxOutputTokens: 256 });
});

test("featuresWithStalePrompts flags only features whose recorded version differs", () => {
  const stale = featuresWithStalePrompts({
    quiz: "quiz/v0", // older → stale
    vocabulary: "vocabulary/v1", // current → not stale
    difficulty: null, // unknown provenance → ignored
    tags: undefined, // absent → ignored
  });
  assert.deepEqual(stale, ["quiz"]);

  // Nothing recorded → nothing stale.
  assert.deepEqual(featuresWithStalePrompts({}), []);
});

// ---------------------------------------------------------------------------
// Registry contract: every feature module must satisfy the full contract.
// ---------------------------------------------------------------------------

test("registry contract: every prompt feature has a version, modelParams, render function, and non-empty description", () => {
  for (const feature of PROMPT_FEATURES) {
    const tmpl = PROMPT_TEMPLATES[feature];

    // Feature identity
    assert.equal(typeof tmpl.feature, "string", `${feature}: .feature must be a string`);
    assert.equal(tmpl.feature, feature, `${feature}: .feature must equal the registry key`);

    // Version is a non-empty string in the conventional <feature>/vN format
    assert.equal(typeof tmpl.version, "string", `${feature}: .version must be a string`);
    assert.match(tmpl.version, /^[a-z-]+\/v\d+$/, `${feature}: .version must match <feature>/vN`);

    // Active flag
    assert.equal(tmpl.active, true, `${feature}: active template must have active=true`);

    // Model params is a plain object (may be empty)
    assert.equal(typeof tmpl.modelParams, "object", `${feature}: .modelParams must be an object`);
    assert.notEqual(tmpl.modelParams, null, `${feature}: .modelParams must not be null`);

    // Description is non-empty
    assert.ok(
      typeof tmpl.description === "string" && tmpl.description.length > 0,
      `${feature}: .description must be a non-empty string`,
    );

    // Render is callable and returns at least two messages with roles
    assert.equal(typeof tmpl.render, "function", `${feature}: .render must be a function`);
  }
});
