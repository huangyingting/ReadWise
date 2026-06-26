import type { PromptTemplate, TranslationPromptVars } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const translationTemplate: PromptTemplate<TranslationPromptVars> = {
  feature: "translation",
  version: "translation/v1",
  active: true,
  modelParams: {},
  description: "Faithful, paragraph-preserving article translation (chunk-aware).",
  render: ({ label, title, chunk, isPart }) => {
    const partNote = isPart
      ? " You are translating one section of a longer article; translate it " +
        "faithfully on its own without adding intro/outro text."
      : "";
    return [
      {
        role: "system",
        content:
          `You are a professional translator. Translate the user's article into ${label}. ` +
          "Preserve paragraph breaks. Output only the translated text with no commentary, " +
          "no notes, and no markdown fences." +
          partNote +
          " " +
          CONTENT_ISOLATION_NOTICE,
      },
      {
        role: "user",
        content: `Title: ${title}\n\n${wrapUntrustedContent(chunk)}`,
      },
    ];
  },
};

export default translationTemplate;
