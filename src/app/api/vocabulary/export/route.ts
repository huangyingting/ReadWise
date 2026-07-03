import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getSavedWords } from "@/lib/lexical/saved-words";
import { parseExportQuery, type ExportFormat } from "@/lib/vocabulary/schemas";
import { csvField } from "@/lib/csv";

type SavedWords = Awaited<ReturnType<typeof getSavedWords>>;

const CSV_HEADER = "word,explanation,example,articleId,savedAt\n";
const EXPORT_CONTENT_TYPE: Record<ExportFormat, string> = {
  anki: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

function toCSV(words: SavedWords): string {
  const rows = words.map((w) =>
    [
      csvField(w.word),
      csvField(w.explanation),
      csvField(w.example),
      csvField(w.articleId),
      csvField(w.createdAt.toISOString()),
    ].join(","),
  );
  return CSV_HEADER + rows.join("\n");
}

function toAnki(words: SavedWords): string {
  // Tab-separated: front = word, back = explanation + (example) if present.
  // Anki's "Text files" importer accepts plain TSV with no header.
  return words
    .map((w) => {
      const back = [w.explanation, w.example ? `"${w.example}"` : null]
        .filter(Boolean)
        .join(" — ");
      return `${w.word}\t${back}`;
    })
    .join("\n");
}

function vocabularyExportResponse(
  content: string,
  format: ExportFormat,
  date: string,
): NextResponse {
  const extension = format === "anki" ? "txt" : "csv";
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename="readwise-vocabulary-${date}.${extension}"`,
    },
  });
}

export const GET = createHandler(
  {
    query: parseExportQuery,
  },
  async ({ session, query }) => {
    const words = await getSavedWords(session.user.id);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "anki") {
      return vocabularyExportResponse(toAnki(words), "anki", date);
    }

    // Default: CSV
    return vocabularyExportResponse(toCSV(words), "csv", date);
  },
);
