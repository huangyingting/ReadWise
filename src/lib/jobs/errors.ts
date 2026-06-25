/**
 * Job error types and classification (RW-015).
 */

export type JobErrorKind = "provider" | "validation" | "missing" | "permission" | "unknown";

/**
 * Error carrying retry intent. `permanent` permanent failures skip retries and
 * go straight to DEAD_LETTER. By default validation / missing / permission
 * failures are permanent; provider/unknown failures are transient (retryable).
 */
export class JobError extends Error {
  readonly kind: JobErrorKind;
  readonly permanent: boolean;
  constructor(message: string, opts: { kind?: JobErrorKind; permanent?: boolean } = {}) {
    super(message);
    this.name = "JobError";
    this.kind = opts.kind ?? "unknown";
    this.permanent =
      opts.permanent ??
      (this.kind === "validation" || this.kind === "missing" || this.kind === "permission");
  }
}

export type ClassifiedError = { kind: JobErrorKind; permanent: boolean; message: string };

/** Classifies an arbitrary error. Unknown errors are treated as transient. */
export function classifyJobError(err: unknown): ClassifiedError {
  if (err instanceof JobError) {
    return { kind: err.kind, permanent: err.permanent, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "provider", permanent: false, message };
}
