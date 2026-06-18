"use client";

import { useState } from "react";

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

export default function ArticleTranslation({
  articleId,
  languages,
}: {
  articleId: string;
  languages: SupportedLanguage[];
}) {
  const [lang, setLang] = useState(languages[0]?.code ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationResponse | null>(null);

  async function handleTranslate() {
    if (!lang || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
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
      setError(err instanceof Error ? err.message : "Translation failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const paragraphs = result
    ? result.content.split(/\n{2,}/).filter((p) => p.trim().length > 0)
    : [];

  return (
    <section className="translation" aria-label="Article translation">
      <div className="translation-controls">
        <label htmlFor="translation-lang" className="muted">
          Translate to
        </label>
        <select
          id="translation-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          disabled={loading}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleTranslate}
          disabled={loading || !lang}
        >
          {loading ? "Translating…" : "Translate"}
        </button>
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
              ? " · translation service unavailable"
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
    </section>
  );
}
