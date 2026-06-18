import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getSavedWords } from "@/lib/vocabulary";
import StudyList from "@/components/StudyList";

export default async function StudyPage() {
  const session = await requireSession("/study");
  const words = await getSavedWords(session.user.id);

  return (
    <main className="container">
      <h1>Study list</h1>
      <p className="muted">
        {words.length} saved {words.length === 1 ? "word" : "words"}
      </p>

      <section style={{ marginTop: "1.5rem" }}>
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

      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
    </main>
  );
}
