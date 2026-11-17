/**
 * Unit tests for the reading-skill taxonomy, content maturity bands, and
 * browse facet parsing (#1302) — plus the guard that keeps the migration's
 * SQL back-fill in step with the TypeScript classifier.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_READING_SKILL,
  READING_SKILLS,
  READING_SKILL_KEYS,
  READING_SKILL_RULES,
  classifyQuestionSkill,
  isReadingSkill,
  normalizeReadingSkill,
  readingSkillLabel,
  shortStandardCode,
  standardCodeFor,
} from "@/lib/learning/reading-skills";
import {
  DEFAULT_MATURITY_BAND,
  FILTERABLE_MATURITY_BANDS,
  MATURITY_BANDS,
  MATURITY_BAND_LABELS,
  isMaturityBand,
  maturityBandsSuitableFor,
} from "@/lib/article-library/maturity";
import { parseBrowseFacets } from "@/lib/browse-facets";

test("the taxonomy covers the six anchor reading skills with standard codes", () => {
  assert.deepEqual(READING_SKILL_KEYS, [
    "textual_evidence",
    "main_idea",
    "cause_effect",
    "vocabulary_in_context",
    "point_of_view",
    "argument",
  ]);
  assert.equal(standardCodeFor("main_idea"), "CCRA.R.2");
  assert.equal(shortStandardCode("argument"), "R.8");
  assert.equal(readingSkillLabel("vocabulary_in_context"), "Vocabulary in context");
  assert.equal(isReadingSkill("main_idea"), true);
  assert.equal(isReadingSkill("Main idea"), false);
  assert.equal(isReadingSkill(null), false);
  assert.equal(new Set(READING_SKILLS.map((skill) => skill.standardCode)).size, READING_SKILLS.length);
});

test("classifyQuestionSkill applies the ordered keyword rules", () => {
  const cases: Array<[string, string]> = [
    ["Which word is closest in meaning to 'resilient'?", "vocabulary_in_context"],
    ["As used in paragraph 3, the word 'scarce' most likely means:", "vocabulary_in_context"],
    ["What is the main idea of the article?", "main_idea"],
    ["Which sentence is the best summary of the text?", "main_idea"],
    ["Which claim does the scientist make about coral?", "argument"],
    ["What is the author's purpose in the final paragraph?", "point_of_view"],
    ["Why did the author include the interview?", "point_of_view"],
    ["Why did the city close the bridge?", "cause_effect"],
    ["What happened as a result of the drought?", "cause_effect"],
    ["According to the article, how many people attended?", "textual_evidence"],
    ["Where was the milestone stone placed?", "textual_evidence"],
  ];
  for (const [question, skill] of cases) {
    assert.equal(classifyQuestionSkill(question), skill, question);
  }
  assert.equal(classifyQuestionSkill(""), DEFAULT_READING_SKILL);
});

test("normalizeReadingSkill accepts keys, codes, and labels, else classifies", () => {
  const question = "According to the text, what year was it?";
  assert.equal(normalizeReadingSkill("main_idea", question), "main_idea");
  assert.equal(normalizeReadingSkill("Main Idea", question), "main_idea");
  assert.equal(normalizeReadingSkill("cause-effect", question), "cause_effect");
  assert.equal(normalizeReadingSkill("R.4", question), "vocabulary_in_context");
  assert.equal(normalizeReadingSkill("CCRA.R.6", question), "point_of_view");
  assert.equal(normalizeReadingSkill("argument & claims", question), "argument");
  assert.equal(normalizeReadingSkill("poetry", "Why did the river flood?"), "cause_effect");
  assert.equal(normalizeReadingSkill("ma", question), "textual_evidence", "too-short labels don't match");
  assert.equal(normalizeReadingSkill(undefined, "What is the central idea?"), "main_idea");
  assert.equal(normalizeReadingSkill(42, question), "textual_evidence");
});

/** Parses `WHEN … LIKE '%kw%' … THEN 'skill'` blocks from the back-fill SQL. */
function backfillRules(sql: string): Array<{ skill: string; keywords: string[] }> {
  const caseBody = sql.slice(sql.indexOf('SET "skillTag" = CASE'), sql.indexOf("END;"));
  return [...caseBody.matchAll(/WHEN ([\s\S]*?)THEN '([a-z_]+)'/g)].map(([, conditions, skill]) => ({
    skill: skill!,
    keywords: [...conditions!.matchAll(/LIKE '%([^%]+)%'/g)].map(([, keyword]) => keyword!),
  }));
}

test("the migration back-fill mirrors READING_SKILL_RULES for both providers", () => {
  for (const dir of ["prisma/migrations", "prisma/postgresql/migrations"]) {
    const sql = readFileSync(`${dir}/20261117120000_reading_skills/migration.sql`, "utf8");
    assert.deepEqual(
      backfillRules(sql),
      READING_SKILL_RULES.map((rule) => ({ skill: rule.skill, keywords: [...rule.keywords] })),
      dir,
    );
    assert.match(sql, new RegExp(`ELSE '${DEFAULT_READING_SKILL}'`));
    for (const skill of READING_SKILLS) {
      assert.match(sql, new RegExp(`WHEN '${skill.key}' THEN '${skill.standardCode.replace(/\./g, "\\.")}'`));
    }
  }
});

test("maturity bands are ordered and filters include general-audience content", () => {
  assert.deepEqual([...MATURITY_BANDS], ["elementary", "middle_school", "high_school", "general"]);
  assert.equal(DEFAULT_MATURITY_BAND, "general");
  assert.deepEqual([...FILTERABLE_MATURITY_BANDS], ["elementary", "middle_school", "high_school"]);
  assert.equal(MATURITY_BAND_LABELS.middle_school, "Middle school");
  assert.deepEqual(maturityBandsSuitableFor("elementary"), ["elementary", "general"]);
  assert.deepEqual(maturityBandsSuitableFor("middle_school"), ["elementary", "middle_school", "general"]);
  assert.deepEqual(maturityBandsSuitableFor("high_school"), ["elementary", "middle_school", "high_school", "general"]);
  assert.deepEqual(maturityBandsSuitableFor("general"), ["general"]);
  assert.equal(isMaturityBand("high_school"), true);
  assert.equal(isMaturityBand("adult"), false);
});

test("parseBrowseFacets keeps known values and ignores the rest", () => {
  assert.deepEqual(parseBrowseFacets({ maturity: "middle_school", skill: "main_idea" }), {
    maturityBand: "middle_school",
    skill: "main_idea",
  });
  assert.deepEqual(parseBrowseFacets({ maturity: "general", skill: "gossip" }), { maturityBand: null, skill: null });
  assert.deepEqual(parseBrowseFacets({}), { maturityBand: null, skill: null });
});
