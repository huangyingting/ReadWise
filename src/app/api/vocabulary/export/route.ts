import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getSavedWords } from "@/lib/lexical/saved-words";
import { parseExportQuery } from "@/lib/vocabulary/schemas";

/** Escape a single value for RFC-4180 CSV (wrap in quotes, double inner quotes). */
function csvField(value: string | null | undefined): string {
  const s = value ?? "";
  // Wrap in double-quotes if the value contains a comma, newline, or double-quote.
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(words: Awaited<ReturnType<typeof getSavedWords>>): string {
  const header = "word,explanation,example,articleId,savedAt\n";
  const rows = words.map((w) =>
    [
      csvField(w.word),
      csvField(w.explanation),
      csvField(w.example),
      csvField(w.articleId),
      csvField(w.createdAt.toISOString()),
    ].join(","),
  );
  return header + rows.join("\n");
}

function toAnki(words: Awaited<ReturnType<typeof getSavedWords>>): string {
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

export const GET = createHandler(
  {
    query: parseExportQuery,
  },
  async ({ session, query }) => {
    const words = await getSavedWords(session.user.id);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "anki") {
      const content = toAnki(words);
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="readwise-vocabulary-${date}.txt"`,
        },
      });
    }

    // Default: CSV
    const content = toCSV(words);
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="readwise-vocabulary-${date}.csv"`,
      },
    });
  },
);
