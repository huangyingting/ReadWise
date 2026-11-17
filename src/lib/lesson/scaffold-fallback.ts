/**
 * Deterministic "Apply to your lesson" scaffolds (#1304), used when the AI
 * provider is unconfigured or fails: a before-reading hook, discussion
 * questions, and key terms with the sentence each first appears in. Pure.
 */

export type KeyTerm = { term: string; definition: string | null; context: string | null };

export type LessonScaffold = {
  hook: string;
  questions: string[];
  keyTerms: KeyTerm[];
};

const MAX_KEY_TERMS = 6;
const MIN_TERM_LENGTH = 7;
const MAX_CONTEXT_LENGTH = 240;

const STOPWORDS = new Set([
  "because", "between", "however", "through", "without", "another", "something", "everyone", "anything",
  "although", "therefore", "whether", "including", "according", "against", "already", "several", "different",
  "important", "probably", "actually", "together", "currently", "recently", "possible", "whatever",
  "themselves", "yourself", "ourselves", "himself", "herself", "itself", "nothing", "someone", "people",
  "article", "articles", "reported",
]);

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Up to six distinctive long words, most frequent first, with their first sentence. */
export function extractKeyTerms(text: string): KeyTerm[] {
  const sentences = sentencesOf(text);
  const counts = new Map<string, { count: number; first: number; display: string; context: string; capitalized: boolean; lowercase: boolean }>();
  sentences.forEach((sentence, sentenceIndex) => {
    (sentence.match(/[A-Za-z][A-Za-z'-]*[A-Za-z]/g) ?? []).forEach((raw, position) => {
      const word = raw.toLowerCase();
      if (word.length < MIN_TERM_LENGTH || STOPWORDS.has(word)) return;
      // Sentence-initial capitals say nothing about whether a word is a name.
      const capitalized = raw !== word && position > 0;
      const lowercase = raw === word;
      const entry = counts.get(word);
      if (entry) {
        entry.count += 1;
        entry.capitalized ||= capitalized;
        entry.lowercase ||= lowercase;
      } else counts.set(word, { count: 1, first: sentenceIndex, display: raw, context: sentence, capitalized, lowercase });
    });
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, MAX_KEY_TERMS)
    .map(({ display, context, capitalized, lowercase }) => ({
      // Words only ever capitalized mid-sentence (names, acronyms) keep their case.
      term: (capitalized && !lowercase) || /^[A-Z]{2,}$/.test(display) ? display : display.toLowerCase(),
      definition: null,
      context: context.length > MAX_CONTEXT_LENGTH ? `${context.slice(0, MAX_CONTEXT_LENGTH - 1)}…` : context,
    }));
}

/** Template scaffolds built from the title and key terms. */
export function deterministicLessonScaffold(title: string, text: string): LessonScaffold {
  const keyTerms = extractKeyTerms(text);
  const focus = keyTerms[0]?.term;
  return {
    hook: focus
      ? `Before reading “${title}”, jot down what you already know about ${focus} and one question you hope the article answers.`
      : `Before reading “${title}”, predict what the article will be about from its headline and share one question you have.`,
    questions: [
      `What is the central idea of “${title}”? Which two details best support it?`,
      "Who is affected by the events in the article, and how?",
      "What is one cause and one effect the article describes?",
      "Which point of view or source in the article is most convincing? Why?",
      "How does this article connect to something you have seen or experienced?",
    ],
    keyTerms,
  };
}
