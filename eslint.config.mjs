import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// ── Custom local plugin: import-boundary enforcement (REF-076) ────────────────
// Enforces client/server module boundaries. See eslint-rules/ for rule source
// and docs/refactoring.md § REF-076 for the boundary taxonomy.
const importBoundaryPlugin = {
  rules: {
    "no-server-imports-in-client": require(
      resolve(__dirname, "eslint-rules/no-server-imports-in-client.js")
    ),
    "ui-design-system": require(
      resolve(__dirname, "eslint-rules/ui-design-system.js")
    ),
  },
};

const eslintConfig = [
  { ignores: [".squad/", "node_modules/", ".next/"] },
  ...compat.extends("next/core-web-vitals"),

  // ── Client/server import boundary rule (REF-076) ──────────────────────────
  // Applied to all TypeScript/TSX source files.
  //
  // Legitimate exemptions:
  //   • Next.js server components (page.tsx, layout.tsx, route.ts, loading.tsx,
  //     error.tsx, not-found.tsx, template.tsx) — server by default; no "use
  //     client" directive is present, so the rule does not fire on them.
  //   • Files with an intentional, reviewed cross-boundary import may suppress
  //     a single line:
  //       // eslint-disable-next-line readwise/no-server-imports-in-client -- reason
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { readwise: importBoundaryPlugin },
    rules: {
      "readwise/no-server-imports-in-client": "error",
    },
  },

  // ── Design-system drift guard (incremental rollout) ──────────────────────
  // Start with primitives + migrated surfaces. Broaden these globs as each
  // migration wave completes so legacy screens can be converted intentionally.
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    plugins: { readwise: importBoundaryPlugin },
    rules: {
      "readwise/ui-design-system": [
        "error",
        {
          allowInteractiveElements: true,
          allowCustomFocus: true,
          allowInlineFontSize: true,
          allowLocalStateComponents: true,
        },
      ],
    },
  },
  {
    files: [
      "src/app/signin/**/*.{ts,tsx}",
      "src/app/onboarding/**/*.{ts,tsx}",
      "src/app/(app)/import/**/*.{ts,tsx}",
      "src/app/(app)/welcome/**/*.{ts,tsx}",
      "src/app/global-error.tsx",
      "src/app/(app)/settings/**/*.{ts,tsx}",
      "src/app/(app)/study/**/*.{ts,tsx}",
      "src/app/(app)/teacher/**/*.{ts,tsx}",
      "src/app/(app)/offline/**/*.{ts,tsx}",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
      "src/app/admin/page.tsx",
      "src/app/admin/reports/page.tsx",
      "src/app/admin/sources/page.tsx",
      "src/components/AccountDangerZone.tsx",
      "src/components/OfflineDownloadButton.tsx",
      "src/components/PushReminderToggle.tsx",
      "src/components/ReminderPreferencesForm.tsx",
      "src/components/OfflineSyncIndicator.tsx",
      "src/components/SettingsThemeRow.tsx",
      "src/components/teacher/**/*.{ts,tsx}",
      "src/components/StudyList.tsx",
      "src/components/RailScroller.tsx",
      "src/components/StudyPageShell.tsx",
      "src/components/VocabularyJournal.tsx",
      "src/components/FlashcardReview.tsx",
      "src/components/CardBookmarkButton.tsx",
      "src/components/CardThumbnail.tsx",
      "src/components/DashboardLevelFilter.tsx",
      "src/components/DashboardWelcomeBanner.tsx",
      "src/components/flashcard/ReviewComplete.tsx",
      "src/components/flashcard/ClozeCard.tsx",
      "src/components/flashcard/FlashcardFace.tsx",
      "src/components/flashcard/FlashcardPrimitives.tsx",
      "src/components/flashcard/GradeButtons.tsx",
      "src/components/flashcard/ReviewProgress.tsx",
      "src/components/flashcard/ReviewStartCard.tsx",
      "src/components/admin/AdminTableWrap.tsx",
      "src/components/legal/LegalPageShell.tsx",
      "src/components/ReaderBookmarkCluster.tsx",
      "src/components/ArticleDictation.tsx",
      "src/components/ArticleDifficultyFeedback.tsx",
      "src/components/ArticleStudySection.tsx",
      "src/components/ArticleTutor.tsx",
      "src/components/ArticleVocabulary.tsx",
      "src/components/BilingualBody.tsx",
      "src/components/ActivityHeatmap.tsx",
      "src/components/AdminTagActions.tsx",
      "src/components/GrammarPopover.tsx",
      "src/components/HighlightEditPopover.tsx",
      "src/components/InlineNoteEditor.tsx",
      "src/components/KeyboardShortcutsModal.tsx",
      "src/components/ListPickerPopover.tsx",
      "src/components/ListSwitcher.tsx",
      "src/components/LevelRecommendationBanner.tsx",
      "src/components/marketing/MarketingHeader.tsx",
      "src/components/command/CommandPalette.tsx",
      "src/components/pronunciation/SentenceStepper.tsx",
      "src/components/reader/ReaderDisplayPanel.tsx",
      "src/components/reader/wordLookup/DictionaryPopover.tsx",
      "src/components/ReaderListenButton.tsx",
      "src/components/ReaderMiniPlayer.tsx",
      "src/components/ReaderNotesPanel.tsx",
      "src/components/ReaderPanelErrorBoundary.tsx",
      "src/components/ReaderTools.tsx",
      "src/components/ReaderToolsSurface.tsx",
      "src/components/SelectionToolbar.tsx",
      "src/components/SentenceTranslatePopover.tsx",
      "src/components/shell/AppSidebar.tsx",
      "src/components/shell/BottomTabBar.tsx",
      "src/components/shell/HeaderSearch.tsx",
      "src/components/shell/MoreSheet.tsx",
      "src/components/shell/ThemeToggle.tsx",
      "src/components/shell/UserMenu.tsx",
      "src/components/WordLookupHint.tsx",
    ],
    plugins: { readwise: importBoundaryPlugin },
    rules: {
      "readwise/ui-design-system": "error",
    },
  },
];

export default eslintConfig;
