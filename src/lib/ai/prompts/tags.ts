import type { PromptTemplate, TagsPromptVars } from "./types";
import { TARGET_TAGS } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const tagsTemplate: PromptTemplate<TagsPromptVars> = {
  feature: "tags",
  version: "tags/v1",
  active: true,
  modelParams: {},
  description: "Choose concise Title-Case topic tags as a JSON array of strings.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You label news articles with topic tags for discovery. From the user's " +
        `article, choose up to ${TARGET_TAGS} concise topic tags (1-3 words each, ` +
        "Title Case, e.g. \"Climate Change\", \"Artificial Intelligence\"). Respond " +
        "ONLY with a JSON array of tag strings. No markdown, no commentary, JSON " +
        "array only. " +
        CONTENT_ISOLATION_NOTICE,
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${wrapUntrustedContent(source)}`,
    },
  ],
};

export default tagsTemplate;
