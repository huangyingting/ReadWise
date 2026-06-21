/**
 * CEFR placement mini-quiz (#120).
 *
 * A static curated bank of reading comprehension questions — one set per
 * CEFR level. All content is original (not scraped) so no copyright issues.
 *
 * `getPlacementQuestions(level)` returns the 3-question set for the given
 * level (or the nearest available level). `suggestLevel` is a pure function
 * that decides whether to suggest a lower CEFR level based on the score.
 */
import { ENGLISH_LEVELS, type EnglishLevel } from "@/lib/profile";

export interface PlacementQuestion {
  id: string;
  passage: string;
  question: string;
  options: string[];
  correctIndex: number;
}

/** levelRank without importing difficulty (avoids server-only deps from client). */
export function placementLevelRank(level: string): number {
  return ENGLISH_LEVELS.indexOf(level as EnglishLevel);
}

/**
 * Pure function. Returns the suggested CEFR level or `null` when no change
 * is recommended.
 *
 * - If `score / total <= 1/3` (i.e. 0 or 1 out of 3), suggest one level
 *   lower — but never below A1.
 * - Otherwise returns `null` (no adjustment).
 */
export function suggestLevel(
  score: number,
  total: number,
  selfReportedLevel: EnglishLevel,
): EnglishLevel | null {
  if (total === 0) return null;
  if (score / total > 1 / 3) return null;
  const currentRank = placementLevelRank(selfReportedLevel);
  if (currentRank <= 0) return null;
  return ENGLISH_LEVELS[currentRank - 1];
}

// ---------------------------------------------------------------------------
// Static question bank — 3 questions per CEFR level.
// Passages are short and original; questions test literal comprehension only.
// ---------------------------------------------------------------------------

const BANK: Record<EnglishLevel, PlacementQuestion[]> = {
  A1: [
    {
      id: "a1-1",
      passage: "My name is Anna. I live in a small town. I have a cat and a dog. I like to walk in the park.",
      question: "Where does Anna walk?",
      options: ["At school", "In the park", "At home", "On the beach"],
      correctIndex: 1,
    },
    {
      id: "a1-2",
      passage: "Tom is eight years old. He goes to school every day. He has two brothers and one sister.",
      question: "How many sisters does Tom have?",
      options: ["Two", "Three", "None", "One"],
      correctIndex: 3,
    },
    {
      id: "a1-3",
      passage: "It is Sunday. The shop is closed. Maria wants to buy bread but she cannot.",
      question: "Why can Maria not buy bread?",
      options: ["She has no money", "The shop is closed", "It is raining", "The bread is finished"],
      correctIndex: 1,
    },
  ],
  A2: [
    {
      id: "a2-1",
      passage: "Carlos moved to London last year. He studies English every morning at a language school. In the afternoons he explores the city by bus.",
      question: "How does Carlos explore London?",
      options: ["By bicycle", "On foot", "By bus", "By train"],
      correctIndex: 2,
    },
    {
      id: "a2-2",
      passage: "Sarah works in a café from Monday to Friday. She finishes work at six o'clock and usually cooks dinner at home.",
      question: "What does Sarah usually do after work?",
      options: ["Goes to the gym", "Watches television", "Cooks dinner", "Visits friends"],
      correctIndex: 2,
    },
    {
      id: "a2-3",
      passage: "The library opens at nine in the morning and closes at eight in the evening. It is closed on public holidays.",
      question: "When is the library closed?",
      options: ["Every Sunday", "After eight in the evening", "On public holidays and after 8 pm", "Only in the morning"],
      correctIndex: 2,
    },
  ],
  B1: [
    {
      id: "b1-1",
      passage: "Scientists have discovered that regular exercise improves not only physical health but also mental well-being. Even a thirty-minute walk can reduce feelings of stress and anxiety.",
      question: "According to the passage, what does regular exercise improve?",
      options: [
        "Only physical fitness",
        "Only mental health",
        "Both physical health and mental well-being",
        "Sleep quality alone",
      ],
      correctIndex: 2,
    },
    {
      id: "b1-2",
      passage: "The new train service between the two cities has cut travel time from three hours to just ninety minutes. Ticket prices, however, remain the same as before.",
      question: "What has NOT changed with the new train service?",
      options: ["The route", "The travel time", "The ticket prices", "The number of stops"],
      correctIndex: 2,
    },
    {
      id: "b1-3",
      passage: "Many young people prefer renting a home to buying one because renting offers more flexibility. They can move to a new city for work without worrying about selling a property.",
      question: "Why do many young people prefer renting?",
      options: [
        "It is always cheaper",
        "It provides more flexibility",
        "Properties are difficult to find",
        "Buying requires a long contract",
      ],
      correctIndex: 1,
    },
  ],
  B2: [
    {
      id: "b2-1",
      passage: "Urban farming initiatives are gaining traction in cities worldwide. Proponents argue that growing food locally reduces transport emissions and increases community resilience, whereas critics question whether the land could be better used for housing.",
      question: "What argument do critics of urban farming make?",
      options: [
        "It produces low-quality food",
        "It increases transport emissions",
        "The land might be better used for housing",
        "It is too expensive to set up",
      ],
      correctIndex: 2,
    },
    {
      id: "b2-2",
      passage: "The documentary sparked controversy because it presented only one side of a complex debate, omitting evidence that challenged its central thesis. Several academics called for a follow-up programme to address the imbalance.",
      question: "Why did academics call for a follow-up programme?",
      options: [
        "To promote the documentary further",
        "To address the one-sided presentation",
        "To challenge the academics' own research",
        "To fund further documentaries",
      ],
      correctIndex: 1,
    },
    {
      id: "b2-3",
      passage: "Remote work has blurred the boundary between professional and personal time. While employees gain flexibility, they often report difficulty switching off, leading to longer working hours and increased burnout.",
      question: "What is a reported downside of remote work?",
      options: [
        "Reduced productivity",
        "Lack of communication tools",
        "Difficulty separating work from personal time",
        "Higher commuting costs",
      ],
      correctIndex: 2,
    },
  ],
  C1: [
    {
      id: "c1-1",
      passage: "The phenomenon of 'linguistic relativity', often associated with the Sapir-Whorf hypothesis, posits that the language one speaks shapes one's perception of reality. Although strong versions of the hypothesis have largely been discredited, moderate claims — that language influences habitual thought — continue to attract empirical support.",
      question: "What does the passage say about strong versions of the Sapir-Whorf hypothesis?",
      options: [
        "They are widely accepted in contemporary linguistics",
        "They have largely been discredited",
        "They focus only on habitual thought",
        "They have never been tested empirically",
      ],
      correctIndex: 1,
    },
    {
      id: "c1-2",
      passage: "Behavioural economists have demonstrated that individuals systematically deviate from the rational-actor model. Loss aversion, for instance, causes people to weight potential losses more heavily than equivalent gains, leading to suboptimal decision-making in financial contexts.",
      question: "How does loss aversion affect decision-making?",
      options: [
        "People value gains more than equivalent losses",
        "People make optimal financial decisions",
        "People weight losses more heavily than equivalent gains",
        "People avoid financial decisions altogether",
      ],
      correctIndex: 2,
    },
    {
      id: "c1-3",
      passage: "The proliferation of generative AI tools has prompted renewed debate about authorship and intellectual property. Critics argue that models trained on copyrighted material effectively constitute unauthorised reproduction, while proponents maintain that training data falls under fair-use provisions.",
      question: "What do proponents of generative AI argue regarding training data?",
      options: [
        "It should be licensed from authors",
        "It constitutes unauthorised reproduction",
        "It falls under fair-use provisions",
        "It is irrelevant to authorship debates",
      ],
      correctIndex: 2,
    },
  ],
  C2: [
    {
      id: "c2-1",
      passage: "The ontological argument for the existence of God, first articulated by Anselm of Canterbury in the eleventh century, proceeds from the concept of God as 'that than which nothing greater can be conceived' to the conclusion that God must exist in reality, since a being that existed only in the mind would be surpassed by one that also existed in reality.",
      question: "According to Anselm's argument, why must God exist in reality?",
      options: [
        "Because the concept of God is self-evident",
        "Because a God existing only in the mind would be less than the greatest conceivable being",
        "Because empirical evidence supports God's existence",
        "Because believers outnumber non-believers",
      ],
      correctIndex: 1,
    },
    {
      id: "c2-2",
      passage: "Epistemic injustice, as conceptualised by Miranda Fricker, encompasses two primary forms: testimonial injustice, whereby a speaker receives less credibility than they deserve owing to prejudice, and hermeneutical injustice, which arises when a gap in collective interpretive resources puts someone at an unfair disadvantage when trying to make sense of their social experience.",
      question: "What is hermeneutical injustice?",
      options: [
        "Giving too much credibility to an undeserving speaker",
        "A disadvantage caused by gaps in collective interpretive resources",
        "Denying someone access to legal testimony",
        "A form of linguistic discrimination in written texts",
      ],
      correctIndex: 1,
    },
    {
      id: "c2-3",
      passage: "Apophatic theology — or 'negative theology' — holds that the divine is fundamentally beyond all human concepts and language, and that affirmative statements about God inevitably distort the divine nature. Instead, practitioners use negation to approach the ineffable, speaking of what God is not rather than what God is.",
      question: "What distinguishes apophatic theology from other theological approaches?",
      options: [
        "It emphasises affirmative descriptions of God",
        "It claims God cannot be approached through any means",
        "It defines God through negation rather than positive attributes",
        "It rejects the existence of the divine entirely",
      ],
      correctIndex: 2,
    },
  ],
};

/**
 * Returns the 3-question placement set for the given CEFR level.
 * Falls back to the nearest available level if not found (shouldn't happen
 * since all levels are covered).
 */
export function getPlacementQuestions(level: EnglishLevel): PlacementQuestion[] {
  return BANK[level] ?? BANK.B1;
}
