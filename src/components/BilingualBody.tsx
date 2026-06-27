"use client";

/**
 * BilingualBody (#113) — parallel bilingual reading view.
 *
 * Wraps <WordLookup> and, when bilingual mode is active, injects translated
 * paragraphs as plain-text DOM nodes immediately after each source <p> in the
 * prose container. Dictionary word-click continues to work on source
 * paragraphs because WordLookup is unchanged; translated paragraphs have
 * pointer-events:none so they do not interfere with selection.
 *
 * Toggle and language preference are persisted in localStorage under
 * "readwise:bilingual" (a JSON object). State is loaded once on mount to
 * prevent SSR/hydration mismatch.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { Button, Select } from "@/components/ui";
import WordLookup from "@/components/WordLookup";
import AiBadge from "@/components/AiBadge";
import { getTranslateLang, setTranslateLang } from "@/lib/translate-lang";
import {
  splitHtmlParagraphs,
  splitTranslationParagraphs,
  alignParagraphs,
} from "@/lib/bilingual";
import type { SupportedLanguage } from "@/lib/supported-languages";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { t } from "@/lib/i18n";

const BILINGUAL_PREFS_KEY = STORAGE_KEYS.BILINGUAL_PREFS;

interface BilingualPrefs {
  enabled: boolean;
  lang: string;
}

function loadBilingualPrefs(defaultLang: string): BilingualPrefs {
  if (typeof window === "undefined") return { enabled: false, lang: defaultLang };
  try {
    const raw = localStorage.getItem(BILINGUAL_PREFS_KEY);
    if (!raw) return { enabled: false, lang: getTranslateLang() };
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "enabled" in parsed &&
      "lang" in parsed &&
      typeof (parsed as { enabled: unknown }).enabled === "boolean" &&
      typeof (parsed as { lang: unknown }).lang === "string"
    ) {
      return parsed as BilingualPrefs;
    }
  } catch {
    // ignore
  }
  return { enabled: false, lang: getTranslateLang() };
}

function saveBilingualPrefs(prefs: BilingualPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BILINGUAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

type TranslationData = {
  lang: string;
  languageLabel: string;
  content: string;
  fallback: boolean;
};

export default function BilingualBody({
  html,
  articleId,
  languages,
}: {
  html: string;
  articleId: string;
  languages: SupportedLanguage[];
}) {
  const defaultLang = languages[0]?.code ?? "es";

  const [prefs, setPrefs] = useState<BilingualPrefs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translation, setTranslation] = useState<TranslationData | null>(null);
  const [controlsExpanded, setControlsExpanded] = useState(false);

  // Load prefs from localStorage on mount (client-only).
  useEffect(() => {
    setPrefs(loadBilingualPrefs(defaultLang));
  }, [defaultLang]);

  const enabled = prefs?.enabled ?? false;
  const lang = prefs?.lang ?? defaultLang;

  // Fetch translation when bilingual mode is enabled or language changes.
  const fetchTranslation = useCallback(
    async (targetLang: string, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reader/${articleId}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang: targetLang }),
          signal,
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(d?.error ?? "Translation failed");
        }
        const data = (await res.json()) as TranslationData;
        setTranslation(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Translation failed");
        setTranslation(null);
      } finally {
        setLoading(false);
      }
    },
    [articleId],
  );

  // Auto-fetch when enabled + language is set.
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    void fetchTranslation(lang, controller.signal);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, lang, fetchTranslation]);

  // -------------------------------------------------------------------------
  // DOM injection: insert translated paragraphs after each source <p> in the
  // WordLookup prose div. We find the prose by its stable class name.
  // -------------------------------------------------------------------------
  const injectedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !translation || loading || translation.fallback) {
      // Remove any injected bilingual translations when mode is off, loading,
      // or the translation is a fallback (no real per-paragraph text exists —
      // the fallback is surfaced as a single banner above the body instead).
      document
        .querySelectorAll(".bilingual-translation")
        .forEach((el) => el.remove());
      injectedRef.current = false;
      return;
    }

    const proseEl = document.querySelector<HTMLElement>(".word-lookup-prose");
    if (!proseEl) return;

    // Remove stale translations before re-injecting (e.g. lang change).
    proseEl
      .querySelectorAll(".bilingual-translation")
      .forEach((el) => el.remove());

    const srcParagraphs = splitHtmlParagraphs(html);
    const transParagraphs = splitTranslationParagraphs(translation.content);
    const pairs = alignParagraphs(srcParagraphs, transParagraphs);

    // Build a flat index of direct paragraph-like children in the prose el
    // that correspond to our source paragraph chunks.
    const proseParagraphs = Array.from(proseEl.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > blockquote, :scope > li, :scope > div"));

    pairs.forEach(({ trans }, i) => {
      if (!trans) return;
      const sourcePara = proseParagraphs[i];
      if (!sourcePara) return;

      const transEl = document.createElement("p");
      transEl.className = "bilingual-translation";
      transEl.setAttribute("lang", translation.lang);
      transEl.setAttribute("aria-label", "Translation");
      transEl.textContent = trans; // plain text — safe (no innerHTML)
      sourcePara.insertAdjacentElement("afterend", transEl);
    });

    injectedRef.current = true;

    return () => {
      proseEl
        .querySelectorAll(".bilingual-translation")
        .forEach((el) => el.remove());
      injectedRef.current = false;
    };
  }, [enabled, translation, loading, html, lang]);

  function toggleBilingual() {
    const next = !enabled;
    const newPrefs: BilingualPrefs = { enabled: next, lang };
    setPrefs(newPrefs);
    saveBilingualPrefs(newPrefs);
    if (!next) {
      setTranslation(null);
      setError(null);
    }
    setControlsExpanded(next);
  }

  function changeLang(newLang: string) {
    const newPrefs: BilingualPrefs = { enabled, lang: newLang };
    setPrefs(newPrefs);
    saveBilingualPrefs(newPrefs);
    setTranslateLang(newLang); // keep shared language key in sync
    setTranslation(null); // trigger re-fetch
  }

  return (
    <>
      {/* Bilingual toggle strip — rendered above the article prose */}
      <div className="bilingual-controls" suppressHydrationWarning>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`bilingual-toggle-btn${enabled ? " bilingual-toggle-btn--active" : ""}`}
          onClick={toggleBilingual}
          aria-pressed={enabled}
          aria-label={enabled ? "Disable bilingual view" : "Enable bilingual view"}
          title={enabled ? "Turn off bilingual view" : "Show paragraph translations side-by-side"}
        >
          <Languages size={14} aria-hidden />
          <span>Bilingual</span>
        </Button>

        {(enabled || controlsExpanded) && (
          <Select
            aria-label="Translation language"
            value={lang}
            onChange={(e) => changeLang(e.target.value)}
            disabled={loading}
            selectSize="sm"
            className="bilingual-lang-select"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        )}

        {loading && (
          <span className="bilingual-status muted" aria-live="polite">
            Loading translation…
          </span>
        )}

        {error && (
          <span
            className="bilingual-status bilingual-error"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </span>
        )}
      </div>

      {/* Single fallback banner — shown above the body when the translation is
          unavailable, instead of mislabeling individual paragraphs (#172). */}
      {enabled && translation?.fallback && !loading && (
        <div className="bilingual-fallback-banner" role="status" aria-live="polite">
          <AiBadge />
          <span>{t("ai.translation.unavailable")}</span>
        </div>
      )}

      {/* Article prose — WordLookup unchanged; translations are injected by the useEffect above */}
      <WordLookup html={html} articleId={articleId} languages={languages} />
    </>
  );
}
