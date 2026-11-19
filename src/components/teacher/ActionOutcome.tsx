/** The polite success summary or alert error shown under a teacher action button. */
export function ActionOutcome({ summary, error }: { summary: string | null; error: string | null }) {
  return (
    <>
      {summary ? (
        <p aria-live="polite" className="m-0 text-[length:var(--text-xs)] text-text-muted">
          {summary}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--text-xs)] text-danger-text">
          {error}
        </p>
      ) : null}
    </>
  );
}
