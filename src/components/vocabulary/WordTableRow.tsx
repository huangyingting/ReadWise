"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatShortDate } from "@/lib/display-format";
import type { WordEntry } from "@/components/VocabularyJournal";

interface WordTableRowProps {
  word: WordEntry;
  articles: Record<string, string>;
  selected: boolean;
  onToggle: () => void;
}

export function WordTableRow({ word, articles, selected, onToggle }: WordTableRowProps) {
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${word.word}`}
          className="h-4 w-4 rounded border-border"
        />
      </td>
      <td>
        <strong className="vocabulary-word text-[length:var(--text-sm)]">{word.word}</strong>
        {word.contextSentence || word.example ? (
          <p className="text-[length:var(--text-xs)] text-text-muted m-0 mt-[var(--space-1)] italic max-w-[28ch]">
            &ldquo;{word.contextSentence ?? word.example}&rdquo;
          </p>
        ) : null}
      </td>
      <td>
        <p className="text-[length:var(--text-sm)] text-text m-0 max-w-[30ch]">
          {word.explanation ?? <span className="text-text-muted">—</span>}
        </p>
      </td>
      <td>
        {word.articleId && articles[word.articleId] ? (
          <Link
            href={`/reader/${word.articleId}`}
            className="text-[length:var(--text-xs)] text-primary hover:underline"
            title={articles[word.articleId]}
          >
            {articles[word.articleId].length > 35
              ? articles[word.articleId].slice(0, 32) + "…"
              : articles[word.articleId]}
          </Link>
        ) : (
          <span className="text-text-muted text-[length:var(--text-xs)]">—</span>
        )}
      </td>
      <td>
        <time
          dateTime={word.createdAt}
          className="text-[length:var(--text-xs)] text-text-muted whitespace-nowrap"
        >
          {formatShortDate(word.createdAt)}
        </time>
      </td>
      <td>
        {word.dueAt == null ? (
          <Badge variant="primary" className="text-[length:var(--text-xs)]">New</Badge>
        ) : new Date(word.dueAt) <= new Date() ? (
          <Badge variant="warning" className="text-[length:var(--text-xs)]">Due</Badge>
        ) : (
          <Badge variant="neutral" className="text-[length:var(--text-xs)] whitespace-nowrap">
            {formatShortDate(word.dueAt)}
          </Badge>
        )}
      </td>
    </tr>
  );
}
