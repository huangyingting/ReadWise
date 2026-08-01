/**
 * Job error types and classification (RW-015).
 */

export type JobErrorKind = "provider" | "validation" | "missing" | "permission" | "unknown";

const DEFAULT_FAILURE_REASON: Record<JobErrorKind, string> = {
  provider: "provider_failure",
  validation: "invalid_job",
  missing: "resource_missing",
  permission: "permission_denied",
  unknown: "unknown_failure",
};
const MACHINE_REASON_RE = /^[a-z0-9][a-z0-9_:-]{0,79}$/;

const PERMANENT_JOB_ERROR_KINDS = new Set<JobErrorKind>([
  "validation",
  "missing",
  "permission",
]);

function isPermanentJobErrorKind(kind: JobErrorKind): boolean {
  return PERMANENT_JOB_ERROR_KINDS.has(kind);
}

/** Controlled, content-free reason used at every persistence/log boundary. */
export function jobFailureReason(kind: JobErrorKind, explicit?: string): string {
  return explicit && MACHINE_REASON_RE.test(explicit)
    ? explicit
    : DEFAULT_FAILURE_REASON[kind];
}

/**
 * Error carrying retry intent. `permanent` permanent failures skip retries and
 * go straight to DEAD_LETTER. By default validation / missing / permission
 * failures are permanent; provider/unknown failures are transient (retryable).
 */
export class JobError extends Error {
  readonly kind: JobErrorKind;
  readonly permanent: boolean;
  readonly reason: string;
  constructor(
    message: string,
    opts: { kind?: JobErrorKind; permanent?: boolean; reason?: string } = {},
  ) {
    super(message);
    this.name = "JobError";
    this.kind = opts.kind ?? "unknown";
    this.permanent = opts.permanent ?? isPermanentJobErrorKind(this.kind);
    this.reason = jobFailureReason(this.kind, opts.reason);
  }
}

export type ClassifiedError = { kind: JobErrorKind; permanent: boolean; reason: string };

/** Classifies an arbitrary error. Unknown errors are treated as transient. */
export function classifyJobError(err: unknown): ClassifiedError {
  if (err instanceof JobError) {
    return { kind: err.kind, permanent: err.permanent, reason: err.reason };
  }
  return {
    kind: "provider",
    permanent: false,
    reason: jobFailureReason("provider"),
  };
}
