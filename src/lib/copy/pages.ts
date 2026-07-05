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

const titleWithSiteName = (title: string) => `${title} — ${SITE_NAME}`;

// ---------------------------------------------------------------------------
// Marketing / auth pages
// ---------------------------------------------------------------------------

export const landing = {
  title: `${SITE_NAME} — Learn English from Real News`,
  description:
    "AI-powered English learning reader. Real articles from BBC Features, National Geographic, Time, and HuffPost — with dictionary, translation, vocabulary, quizzes, narration, and CEFR leveling.",
} as const;

export const signIn = {
  title: titleWithSiteName("Sign in"),
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
  title: titleWithSiteName("Welcome"),
} as const;

// ---------------------------------------------------------------------------
// App pages
// ---------------------------------------------------------------------------

export const welcome = {
  title: `Welcome to ${SITE_NAME}`,
} as const;

export const settings = {
  title: titleWithSiteName("Settings"),
} as const;

export const importPage = {
  title: titleWithSiteName("Import Article"),
} as const;

export const tags = {
  title: "Tags",
} as const;

export const progress = {
  title: titleWithSiteName("My Progress"),
} as const;

export const today = {
  title: titleWithSiteName("Today"),
  description:
    "Your focused daily reading task — one article to read, plus light comprehension and vocabulary review.",
} as const;

export const notes = {
  title: titleWithSiteName("Notes & Highlights"),
} as const;
