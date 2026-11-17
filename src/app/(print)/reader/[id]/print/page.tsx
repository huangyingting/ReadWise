import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { canPrintAnswerKey, loadPrintableArticle } from "@/lib/reader/print";
import { optionLetter, parsePrintMode, PRINT_MODE_LABELS } from "@/lib/reader/print-modes";
import type { QuizQuestion } from "@/lib/quiz";
import type { VocabularyEntry } from "@/lib/vocabulary/service";
import PrintToolbar from "@/components/reader/PrintToolbar";
import { EmptyState } from "@/components/ui";
import CitationText from "@/components/reader/CitationText";

export const metadata: Metadata = {
  title: "Print article",
  robots: { index: false, follow: false },
};

type SearchParams = { mode?: string | string[] };

const RESPONSE_LINES = 8;

function StudentHeader() {
  return (
    <div className="print-student-header" aria-label="Student details">
      {["Name", "Date", "Class"].map((label) => (
        <div key={label}>
          {label}
          <span aria-hidden />
        </div>
      ))}
    </div>
  );
}

function VocabularySection({ vocabulary }: { vocabulary: VocabularyEntry[] }) {
  if (vocabulary.length === 0) return null;
  return (
    <section className="print-section" aria-labelledby="print-vocabulary">
      <h2 id="print-vocabulary">Vocabulary</h2>
      <dl className="print-vocabulary">
        {vocabulary.map((entry) => (
          <div key={entry.word}>
            <dt>{entry.word}</dt>
            <dd>{entry.explanation}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function QuizSection({ quiz }: { quiz: QuizQuestion[] }) {
  if (quiz.length === 0) return null;
  return (
    <section aria-labelledby="print-quiz">
      <h2 id="print-quiz">Quiz</h2>
      <ol className="print-quiz">
        {quiz.map((question) => (
          <li key={question.question}>
            {question.question}
            <ul className="print-quiz-options">
              {question.options.map((option, index) => (
                <li key={option}>
                  <span className="print-bubble" aria-hidden>
                    ○
                  </span>
                  <span>
                    {optionLetter(index)}. {option}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResponseSection() {
  return (
    <section className="print-section" aria-labelledby="print-response">
      <h2 id="print-response">Write about it</h2>
      <p>In your own words, what is the main idea of this article? Use evidence from at least one numbered paragraph.</p>
      <div className="print-lines" aria-hidden>
        {Array.from({ length: RESPONSE_LINES }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>
  );
}

function AnswerKeySection({ quiz }: { quiz: QuizQuestion[] }) {
  return (
    <section className="print-break-before" aria-labelledby="print-answer-key">
      <h2 id="print-answer-key">Answer key</h2>
      {quiz.length > 0 ? (
        <ol className="print-answer-key">
          {quiz.map((question) => (
            <li key={question.question}>
              {optionLetter(question.correctIndex)}. {question.options[question.correctIndex]}
            </li>
          ))}
        </ol>
      ) : (
        <p>No quiz has been generated for this article yet.</p>
      )}
    </section>
  );
}

/**
 * Printable classroom packet (#1306): `?mode=article|worksheet|answer-key`.
 * The answer key is refused (403 page) for anyone who isn't a teacher,
 * content staff, or a platform super-user; rights-restricted articles are
 * never printed.
 */
export default async function PrintArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const mode = parsePrintMode((await searchParams).mode);
  const session = await requireSession(`/reader/${encodeURIComponent(id)}/print?mode=${mode}`);
  const canAnswerKey = await canPrintAnswerKey(session.user);
  if (mode === "answer-key" && !canAnswerKey) redirect("/forbidden");

  const printable = await loadPrintableArticle(id, session.user, mode);
  if (!printable) notFound();

  if (printable.restricted) {
    return (
      <>
        <PrintToolbar articleId={id} mode={mode} canAnswerKey={canAnswerKey} printable={false} />
        <main className="print-sheet">
          <EmptyState
            title="This article can’t be printed"
            description="A content-rights restriction applies to this article, so it isn’t available for printing."
          />
        </main>
      </>
    );
  }

  const { article, bodyHtml, citation, rightsNote, quiz, vocabulary } = printable;
  const withStudyMaterials = mode !== "article";

  return (
    <>
      <PrintToolbar articleId={id} mode={mode} canAnswerKey={canAnswerKey} printable />
      <main className="print-sheet" aria-label={`${PRINT_MODE_LABELS[mode]}: ${article.title}`}>
        {withStudyMaterials ? <StudentHeader /> : null}
        <header>
          <h1>{article.title}</h1>
          {article.author || article.source ? (
            <p className="print-byline">{[article.author, article.source].filter(Boolean).join(" · ")}</p>
          ) : null}
        </header>
        <div className="prose print-article-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        <p className="print-source">
          Source: <CitationText parts={citation.parts} />
        </p>
        {rightsNote ? <p className="print-rights">Rights: {rightsNote}</p> : null}

        {withStudyMaterials ? (
          <>
            <VocabularySection vocabulary={vocabulary} />
            <QuizSection quiz={quiz} />
            {quiz.length === 0 ? (
              <p className="print:hidden text-[length:var(--type-ui)] text-text-muted">
                No quiz has been generated for this article yet — open the Quiz tab in the reader, then print again.
              </p>
            ) : null}
            <ResponseSection />
          </>
        ) : null}
        {mode === "answer-key" ? <AnswerKeySection quiz={quiz} /> : null}
      </main>
    </>
  );
}
