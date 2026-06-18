"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/categories";
import { AGE_RANGES, ENGLISH_LEVELS, GENDERS } from "@/lib/profile";

type Defaults = {
  ageRange: string;
  gender: string;
  englishLevel: string;
  topics: string[];
};

const LEVEL_HINTS: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Proficient",
};

export default function ProfileSettingsForm({
  defaults,
}: {
  defaults: Defaults;
}) {
  const router = useRouter();
  const [ageRange, setAgeRange] = useState(defaults.ageRange);
  const [gender, setGender] = useState(defaults.gender);
  const [englishLevel, setEnglishLevel] = useState(defaults.englishLevel);
  const [topics, setTopics] = useState<string[]>(defaults.topics);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleTopic(slug: string) {
    setSaved(false);
    setTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!englishLevel) {
      setError("Please select your English level.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ageRange, gender, englishLevel, topics }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setSaved(true);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      className="card stack"
      style={{ marginTop: "1rem", maxWidth: 560 }}
      onSubmit={handleSubmit}
    >
      <label className="stack" style={{ display: "block" }}>
        <span>
          <strong>English level</strong>{" "}
          <span className="muted">(required)</span>
        </span>
        <select
          className="btn"
          value={englishLevel}
          onChange={(e) => {
            setSaved(false);
            setEnglishLevel(e.target.value);
          }}
          required
        >
          <option value="">Select a level…</option>
          {ENGLISH_LEVELS.map((level) => (
            <option key={level} value={level}>
              {LEVEL_HINTS[level] ?? level}
            </option>
          ))}
        </select>
      </label>

      <label className="stack" style={{ display: "block" }}>
        <span>
          <strong>Age range</strong> <span className="muted">(optional)</span>
        </span>
        <select
          className="btn"
          value={ageRange}
          onChange={(e) => {
            setSaved(false);
            setAgeRange(e.target.value);
          }}
        >
          <option value="">Prefer not to say</option>
          {AGE_RANGES.map((range) => (
            <option key={range} value={range}>
              {range}
            </option>
          ))}
        </select>
      </label>

      <label className="stack" style={{ display: "block" }}>
        <span>
          <strong>Gender</strong> <span className="muted">(optional)</span>
        </span>
        <select
          className="btn"
          value={gender}
          onChange={(e) => {
            setSaved(false);
            setGender(e.target.value);
          }}
        >
          <option value="">Prefer not to say</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>

      <div className="stack">
        <span>
          <strong>Topics you enjoy</strong>{" "}
          <span className="muted">(optional, pick any)</span>
        </span>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          {CATEGORIES.map((cat) => {
            const selected = topics.includes(cat.slug);
            return (
              <button
                key={cat.slug}
                type="button"
                aria-pressed={selected}
                className={selected ? "btn btn-primary" : "btn"}
                style={{ width: "auto" }}
                onClick={() => toggleTopic(cat.slug)}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <p style={{ color: "#ff6b6b", margin: 0 }} role="alert">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p style={{ color: "#37b24d", margin: 0 }} role="status">
          Preferences saved.
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
