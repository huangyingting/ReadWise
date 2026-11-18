import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { canPrintAnswerKey, loadPrintableArticle } from "@/lib/reader/print";
import { EDUCATOR_PRINT_MODES, optionLetter, parsePrintMode, PRINT_MODE_LABELS } from "@/lib/reader/print-modes";
import { articleHtmlToReaderTextFromSanitized } from "@/lib/content-pipeline";
import { FLUENCY_RUBRIC, extractFluencyPassage, parseFluencyLength } from "@/lib/lesson/fluency";
import { parseReadingLevel } from "@/lib/article-levels/levels";
import type { QuizQuestion } from "@/lib/quiz";
import { readingSkillLabel } from "@/lib/learning/reading-skills";
import type { VocabularyEntry } from "@/lib/vocabulary/service";
import PrintToolbar from "@/components/reader/PrintToolbar";
import { EmptyState } from "@/components/ui";
import CitationText from "@/components/reader/CitationText";

export const metadata: Metadata = {
  title: "Print article",
  robots: { index: false, follow: false },
};

type SearchParams = { mode?: string | string[]; words?: string | string[]; level?: string | string[] };

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
              <strong>
                {optionLetter(question.correctIndex)}. {question.options[question.correctIndex]}
              </strong>
              <span className="print-answer-skill">
                {" "}
                — {question.standardCode.replace(/^CCRA\./, "")} {readingSkillLabel(question.skillTag)}
              </span>
              {question.explanation ? <p className="print-answer-explanation">{question.explanation}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p>No quiz has been generated for this article yet.</p>
      )}
    </section>
  );
}

/** Oral fluency scoring sheet (#1304): passage with cumulative counts + rubric. */
function FluencySheet({ bodyHtml, words }: { bodyHtml: string; words: unknown }) {
  const passage = extractFluencyPassage(articleHtmlToReaderTextFromSanitized(bodyHtml), parseFluencyLength(words));
  return (
    <>
      <section className="print-section" aria-labelledby="print-fluency">
        <h2 id="print-fluency">Oral fluency passage ({passage.wordCount} words)</h2>
        <table className="print-fluency">
          <tbody>
            {passage.lines.map((line) => (
              <tr key={line.cumulative}>
                <td>{line.text}</td>
                <td className="print-fluency-count">{line.cumulative}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="print-section" aria-labelledby="print-fluency-rubric">
        <h2 id="print-fluency-rubric">Scoring</h2>
        <p>Words read in 1 minute: ______ Errors: ______ WCPM (words read − errors): ______ Accuracy: ______%</p>
        <p>{FLUENCY_RUBRIC.accuracy.map((band) => `${band.label}: ${band.range}`).join(" · ")}</p>
        <ol className="print-quiz" reversed>
          {FLUENCY_RUBRIC.prosody.map((level) => (
            <li key={level.score}>{level.label}</li>
          ))}
        </ol>
      </section>
    </>
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
  const query = await searchParams;
  const mode = parsePrintMode(query.mode);
  const session = await requireSession(`/reader/${encodeURIComponent(id)}/print?mode=${mode}`);
  const canAnswerKey = await canPrintAnswerKey(session.user);
  if (EDUCATOR_PRINT_MODES.includes(mode) && !canAnswerKey) redirect("/forbidden");

  const level = parseReadingLevel(Array.isArray(query.level) ? query.level[0] : query.level);
  const printable = await loadPrintableArticle(id, session.user, mode, { level });
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
  const withStudyMaterials = mode === "worksheet" || mode === "answer-key";
  const fluency = mode === "fluency";

  return (
    <>
      <PrintToolbar articleId={id} mode={mode} canAnswerKey={canAnswerKey} printable level={level} />
      <main className="print-sheet" aria-label={`${PRINT_MODE_LABELS[mode]}: ${article.title}`}>
        {withStudyMaterials || fluency ? <StudentHeader /> : null}
        <header>
          <h1>{article.title}</h1>
          {article.author || article.source ? (
            <p className="print-byline">{[article.author, article.source].filter(Boolean).join(" · ")}</p>
          ) : null}
        </header>
        {fluency ? (
          <FluencySheet bodyHtml={bodyHtml} words={query.words} />
        ) : (
          <div className="prose print-article-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        )}
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
