import { requireSession } from "@/lib/session";
import { getSavedWords } from "@/lib/vocabulary";
import { getReviewSummary } from "@/lib/flashcards";
import StudyList from "@/components/StudyList";
import FlashcardReview from "@/components/FlashcardReview";

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

      {/* Flashcard review — above the saved-words list per Saul §4.8 */}
      <FlashcardReview initialDueCount={reviewSummary.dueCount} />

      {/* Saved words list */}
      <section style={{ marginTop: "var(--space-9)" }}>
        <h2
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          style={{ marginBottom: "var(--space-4)" }}
        >
          Saved words
        </h2>
        <p className="text-text-muted text-[length:var(--text-sm)] m-0" style={{ marginBottom: "var(--space-4)" }}>
          {words.length} saved {words.length === 1 ? "word" : "words"}
        </p>

        <StudyList
          words={words.map((w) => ({
            id: w.id,
            word: w.word,
            explanation: w.explanation,
            example: w.example,
            articleId: w.articleId,
          }))}
        />
      </section>
    </main>
  );
}
