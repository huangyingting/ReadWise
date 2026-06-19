import { requireSession } from "@/lib/session";
import { getSavedWords } from "@/lib/vocabulary";
import { getReviewSummary } from "@/lib/flashcards";
import StudyPageShell from "@/components/StudyPageShell";

export default async function StudyPage() {
  const session = await requireSession("/study");
  const [words, reviewSummary] = await Promise.all([
    getSavedWords(session.user.id),
    getReviewSummary(session.user.id),
  ]);

  return (
    <main className="listing-container">
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "var(--space-6)" }}
      >
        Study list
      </h1>

      <StudyPageShell
        words={words.map((w) => ({
          id: w.id,
          word: w.word,
          explanation: w.explanation,
          example: w.example,
          articleId: w.articleId,
        }))}
        initialDueCount={reviewSummary.dueCount}
      />
    </main>
  );
}
