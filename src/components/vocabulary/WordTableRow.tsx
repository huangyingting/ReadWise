"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui";
import { formatShortDate } from "@/lib/display-format";
import type { WordEntry } from "@/components/VocabularyJournal";

interface WordTableRowProps {
  word: WordEntry;
  articles: Record<string, string>;
  selected: boolean;
  onToggle: () => void;
}

const ARTICLE_TITLE_MAX_LENGTH = 35;
const ARTICLE_TITLE_PREFIX_LENGTH = 32;

function getContextSnippet(word: WordEntry): string | null {
  if (!word.contextSentence && !word.example) return null;
  return word.contextSentence ?? word.example ?? "";
}

function getArticleTitle(word: WordEntry, articles: Record<string, string>): string | null {
  if (!word.articleId) return null;
  return articles[word.articleId] ?? null;
}

function formatArticleTitle(title: string): string {
  return title.length > ARTICLE_TITLE_MAX_LENGTH
    ? `${title.slice(0, ARTICLE_TITLE_PREFIX_LENGTH)}…`
    : title;
}

export function WordTableRow({ word, articles, selected, onToggle }: WordTableRowProps) {
  const contextSnippet = getContextSnippet(word);
  const articleTitle = getArticleTitle(word, articles);

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
        {contextSnippet != null ? (
          <p className="text-[length:var(--text-xs)] text-text-muted m-0 mt-[var(--space-1)] italic max-w-[28ch]">
            &ldquo;{contextSnippet}&rdquo;
          </p>
        ) : null}
      </td>
      <td>
        <p className="text-[length:var(--text-sm)] text-text m-0 max-w-[30ch]">
          {word.explanation ?? <span className="text-text-muted">—</span>}
        </p>
      </td>
      <td>
        {word.articleId && articleTitle ? (
          <Tooltip content={articleTitle}>
            <Link
              href={`/reader/${word.articleId}`}
              className="text-[length:var(--text-xs)] text-primary hover:underline"
            >
              {formatArticleTitle(articleTitle)}
            </Link>
          </Tooltip>
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
        <DueBadge dueAt={word.dueAt} />
      </td>
    </tr>
  );
}

function DueBadge({ dueAt }: { dueAt: WordEntry["dueAt"] }) {
  if (dueAt == null) {
    return (
      <Badge variant="primary" className="text-[length:var(--text-xs)]">
        New
      </Badge>
    );
  }

  if (new Date(dueAt) <= new Date()) {
    return (
      <Badge variant="warning" className="text-[length:var(--text-xs)]">
        Due
      </Badge>
    );
  }

  return (
    <Badge variant="neutral" className="text-[length:var(--text-xs)] whitespace-nowrap">
      {formatShortDate(dueAt)}
    </Badge>
  );
}
