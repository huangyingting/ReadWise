"use client";

import { useState, useEffect } from "react";
import { getTranslateLang, setTranslateLang } from "@/lib/translate-lang";
import { Button } from "@/components/ui/Button";
import AiBadge from "@/components/AiBadge";

type SupportedLanguage = {
  code: string;
  label: string;
};

type TranslationResponse = {
  lang: string;
  languageLabel: string;
  content: string;
  cached: boolean;
  fallback: boolean;
};

/**
 * ArticleTranslation (M5 refactor)
 *
 * Stripped of its outer <section> wrapper. The language select renders
 * immediately; translation is fetched on "Translate" button click (unchanged
 * behaviour). Inner UI/fallback handling verbatim.
 *
 * Props:
 *   articleId — the article to translate
 *   languages — list of supported language options
 *   active    — true when the Translate tab is the currently visible panel
 */
export default function ArticleTranslation({
  articleId,
  languages,
}: {
  articleId: string;
  languages: SupportedLanguage[];
  active: boolean;
}) {
  const [lang, setLang] = useState(languages[0]?.code ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationResponse | null>(null);

  // Seed language from the shared localStorage key on mount
  useEffect(() => {
    const stored = getTranslateLang();
    if (languages.some((l) => l.code === stored)) setLang(stored);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTranslate() {
    if (!lang || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    // Client-side AbortController with 30 s timeout — defense-in-depth so the
    // UI can't hang indefinitely even if the server stalls (#56).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/reader/${articleId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Translation failed");
      }
      const data = (await res.json()) as TranslationResponse;
      setResult(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Translation timed out. Please try again.");
      } else {
        setError(err instanceof Error ? err.message : "Translation failed");
      }
      setResult(null);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  const paragraphs = result
    ? result.content.split(/\n{2,}/).filter((p) => p.trim().length > 0)
    : [];

  return (
    <div>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <AiBadge />
      </div>

      <div className="translation-controls">
        <label htmlFor="translation-lang" className="muted">
          Translate to
        </label>
        <select
          id="translation-lang"
          value={lang}
          onChange={(e) => {
            setLang(e.target.value);
            setTranslateLang(e.target.value); // persist to shared key (M13)
          }}
          disabled={loading}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={handleTranslate}
          disabled={loading || !lang}
          loading={loading}
        >
          {loading ? "Translating…" : "Translate"}
        </Button>
      </div>

      {error ? (
        <p className="translation-error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="translation-result">
          <p className="muted translation-meta">
            {result.languageLabel}
            {result.fallback
              ? " · AI feature unavailable — translation is not available right now"
              : result.cached
                ? " · cached"
                : " · newly generated"}
          </p>
          <div className="prose" lang={result.lang}>
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

