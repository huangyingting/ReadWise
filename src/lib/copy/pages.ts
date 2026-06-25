/**
 * Per-page metadata copy (title and description strings).
 *
 * Collecting all static page titles into one module makes copy review
 * straightforward and is the first step toward localization readiness.
 * Dynamic pages (reader article, tag slug) produce their titles at runtime
 * and are not included here.
 *
 * These strings are byte-identical to the originals they replaced.
 */
import { SITE_NAME } from "./site";

// ---------------------------------------------------------------------------
// Marketing / auth pages
// ---------------------------------------------------------------------------

export const landing = {
  title: `${SITE_NAME} — Learn English from Real News`,
  description:
    "AI-powered English learning reader. Real articles from NBC News, National Geographic, Time, and HuffPost — with dictionary, translation, vocabulary, quizzes, narration, and CEFR leveling.",
} as const;

export const signIn = {
  title: `Sign in — ${SITE_NAME}`,
} as const;

export const terms = {
  title: "Terms of Service",
  description: `${SITE_NAME} Terms of Service — rules for using the platform.`,
} as const;

export const privacy = {
  title: "Privacy Policy",
  description: `${SITE_NAME} Privacy Policy — how we collect, use, and protect your data.`,
} as const;

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const onboarding = {
  title: `Welcome — ${SITE_NAME}`,
} as const;

// ---------------------------------------------------------------------------
// App pages
// ---------------------------------------------------------------------------

export const welcome = {
  title: `Welcome to ${SITE_NAME}`,
} as const;

export const settings = {
  title: `Settings — ${SITE_NAME}`,
} as const;

export const importPage = {
  title: `Import Article — ${SITE_NAME}`,
} as const;

export const tags = {
  title: "Tags",
} as const;

export const progress = {
  title: `My Progress — ${SITE_NAME}`,
} as const;

export const notes = {
  title: `Notes & Highlights — ${SITE_NAME}`,
} as const;
