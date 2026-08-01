/** Ad-hoc diagnostic: inspect why marker-validated batches need repair. Not part of the pipeline. */
import { openReadOnly } from "./db";
import { sanitizeArticleHtml } from "@/lib/content-pipeline";
import { splitHtmlParagraphs } from "@/lib/bilingual";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { recommendedPromptForCategory } from "./prompts";
import { chatCompleteWithRetry } from "./vllm-client";
import { CONTENT_ISOLATION_NOTICE, wrapUntrustedContent } from "@/lib/ai/input-safety";
import { isMain, runScript } from "../lib/cli";

type DiagnosticRow = {
  id: string;
  title: string;
  content: string;
  category: string | null;
};

const MARKER_SYSTEM_NOTE =
  " The user message contains multiple numbered paragraphs, each preceded by " +
  "a marker of the exact form [[n]] on its own line (e.g. [[1]], [[2]], ...). " +
  "Translate each paragraph independently. Your reply must reproduce the SAME " +
  "markers, in the SAME order, one per translated paragraph, with no markers " +
  "added, removed, merged, or renumbered — even if a paragraph is very short " +
  "or looks like a fragment. Never merge two numbered paragraphs into one, " +
  "and never split one numbered paragraph into two. Output nothing except " +
  "the markers and their translations.";

export async function main(dbPath = "prisma/provider-dbs/workinprogress.db"): Promise<number> {
  const db = openReadOnly(dbPath);
  try {
    const rows = db.prepare("SELECT id, title, content, category FROM Article ORDER BY id LIMIT 8").all() as DiagnosticRow[];
    for (const row of rows) {
      const sanitized = sanitizeArticleHtml(row.content);
      const blocks = splitHtmlParagraphs(sanitized).map((html, i) => ({
        index: i,
        text: articleHtmlToReaderText(html).trim(),
      }));
      const nonEmpty = blocks.filter((b) => b.text.length > 0).slice(0, 12); // first batch only
      if (nonEmpty.length === 0) continue;
      const input = nonEmpty.map((b, i) => `[[${i + 1}]]\n${b.text}`).join("\n\n");
      const prompt = recommendedPromptForCategory(row.category);
      const result = await chatCompleteWithRetry(
        [
          { role: "system", content: prompt.systemPrompt + MARKER_SYSTEM_NOTE + " " + CONTENT_ISOLATION_NOTICE },
          { role: "user", content: wrapUntrustedContent(input, "article", 200_000) },
        ],
        { temperature: 0.2, maxTokens: 4096 },
      );
      const re = /\[\[(\d+)\]\]/g;
      const foundMarkers = [...result.text.matchAll(re)].map((m) => Number(m[1]));
      const ok = foundMarkers.length === nonEmpty.length && foundMarkers.every((n, i) => n === i + 1);
      console.log(
        `${row.id} blocks=${nonEmpty.length} foundMarkers=${JSON.stringify(foundMarkers)} ok=${ok} finish=${result.finishReason}`,
      );
      if (!ok) {
        console.log("--- RAW RESPONSE (first 600 chars) ---");
        console.log(result.text.slice(0, 600));
        console.log("--- end ---");
      }
    }
    return 0;
  } finally {
    db.close();
  }
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "translation marker diagnostic failed");
  }
}

runAsCli();
