import type { PromptTemplate, ArticleSourcePromptVars } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const lessonScaffoldTemplate: PromptTemplate<ArticleSourcePromptVars> = {
  feature: "lesson-scaffold",
  version: "lesson-scaffold/v1",
  active: true,
  modelParams: { maxOutputTokens: 900 },
  description: "Teacher lesson scaffolds: a before-reading hook, discussion questions, and key terms (#1304).",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You help teachers plan a lesson around a news article for English learners. Return ONLY a JSON array of " +
        'objects: exactly one {"type":"hook","text":"..."} (a one- or two-sentence before-reading prompt that activates ' +
        'background knowledge), four or five {"type":"question","text":"..."} open discussion questions that require ' +
        'evidence from the article, and four to six {"type":"term","term":"...","definition":"..."} key terms from the ' +
        "article with learner-friendly definitions. No markdown. " +
        CONTENT_ISOLATION_NOTICE,
    },
    { role: "user", content: `Title: ${title}\n\n${wrapUntrustedContent(source)}` },
  ],
};

export default lessonScaffoldTemplate;
