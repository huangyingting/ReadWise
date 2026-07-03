import type { PromptTemplate, TranslationPromptVars } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const TRANSLATION_INSTRUCTIONS =
  "Preserve paragraph breaks. Output only the translated text with no commentary, " +
  "no notes, and no markdown fences.";
const PART_TRANSLATION_NOTE =
  " You are translating one section of a longer article; translate it " +
  "faithfully on its own without adding intro/outro text.";

function renderSystemContent(label: string, isPart: boolean): string {
  const partNote = isPart ? PART_TRANSLATION_NOTE : "";
  return (
    `You are a professional translator. Translate the user's article into ${label}. ` +
    TRANSLATION_INSTRUCTIONS +
    partNote +
    " " +
    CONTENT_ISOLATION_NOTICE
  );
}

function renderUserContent(title: string, chunk: string): string {
  return `Title: ${title}\n\n${wrapUntrustedContent(chunk)}`;
}

const translationTemplate: PromptTemplate<TranslationPromptVars> = {
  feature: "translation",
  version: "translation/v1",
  active: true,
  modelParams: {},
  description: "Faithful, paragraph-preserving article translation (chunk-aware).",
  render: ({ label, title, chunk, isPart }) => {
    return [
      {
        role: "system",
        content: renderSystemContent(label, isPart),
      },
      {
        role: "user",
        content: renderUserContent(title, chunk),
      },
    ];
  },
};

export default translationTemplate;
