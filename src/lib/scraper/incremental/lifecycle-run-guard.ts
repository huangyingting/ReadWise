/**
 * Structural body-work guard for baseline/shadow discovery (issue #1088,
 * Phase 1.8).
 *
 * In BASELINE and SHADOW mode a source is only OBSERVING and PROVING identities:
 * it must NEVER fetch an article body, write an Article, or enqueue an
 * article-processing job (the governing invariant). The bounded discovery run
 * handler (`discovery-run.ts`) already never calls those paths; this guard makes
 * that invariant EXPLICIT and TESTABLE by wrapping any such side-effecting port
 * so a call while body work is prohibited is REFUSED before the real dependency
 * runs.
 *
 * Tests inject FAILING body-fetch / Article-write / Job-enqueue dependencies
 * into {@link guardIngestPort}: because the guard refuses the call in
 * BASELINE/SHADOW, the injected dependency is never reached, proving zero body
 * fetches, Article writes, and `ARTICLE_INGEST` jobs (AC2). A future Phase-2
 * caller can reuse the same guard so only an ACTIVE source ever performs body
 * work.
 */
import type { DiscoverySourceLifecycleMode } from "@prisma/client";

import { isBodyWorkProhibited } from "./lifecycle";

/** Thrown when a body-work side effect is attempted while it is prohibited. */
export class BodyWorkProhibitedError extends Error {
  readonly operation: string;
  readonly mode: DiscoverySourceLifecycleMode;

  constructor(operation: string, mode: DiscoverySourceLifecycleMode) {
    super(`body-work operation "${operation}" is prohibited in ${mode} mode`);
    this.name = "BodyWorkProhibitedError";
    this.operation = operation;
    this.mode = mode;
  }
}

/**
 * Asserts that article-body work is permitted for `mode`, throwing
 * {@link BodyWorkProhibitedError} otherwise. `operation` is a controlled,
 * metadata-only label (e.g. "fetch-body", "write-article", "enqueue-ingest") —
 * never a URL or secret.
 */
export function assertBodyWorkAllowed(mode: DiscoverySourceLifecycleMode, operation: string): void {
  if (isBodyWorkProhibited(mode)) {
    throw new BodyWorkProhibitedError(operation, mode);
  }
}

/** Any async side-effecting body-work port (body fetch, Article write, ingest enqueue). */
export type BodyWorkPort<Args extends unknown[], Result> = (...args: Args) => Promise<Result>;

/**
 * Wraps a body-work port so that, while `mode` prohibits body work
 * (BASELINE/SHADOW), invoking the returned port REFUSES with a
 * {@link BodyWorkProhibitedError} and NEVER calls `port`. Otherwise it delegates
 * to `port` unchanged. `operation` labels the port for the refusal error.
 */
export function guardIngestPort<Args extends unknown[], Result>(
  mode: DiscoverySourceLifecycleMode,
  operation: string,
  port: BodyWorkPort<Args, Result>,
): BodyWorkPort<Args, Result> {
  return (...args: Args): Promise<Result> => {
    if (isBodyWorkProhibited(mode)) {
      return Promise.reject(new BodyWorkProhibitedError(operation, mode));
    }
    return port(...args);
  };
}
