/**
 * Worker-side secret resolver seam for authenticated provider ingestion
 * (issue #1099, Phase 2.9).
 *
 * This is the ONLY place a secret-free `credentialRef` (a NAME/handle) is turned
 * into live authentication material, and it does so IN MEMORY, per request:
 *
 *   - The resolved Authorization header value / signed URL is returned to the
 *     caller and is NEVER written to a candidate, alias, observation, Job,
 *     CrawlRun, audit-metadata, log, or error. Only the `credentialRef` name and
 *     sanitized failure categories ever persist (AC1).
 *   - Because only the `credentialRef` is stored, rotating the secret behind a
 *     fixed handle requires NO candidate/job rewrite: the next `resolve()` picks
 *     up the new secret and the source resumes cleanly (AC2).
 *
 * The resolver is an INJECTABLE interface so tests drive it with a FAKE resolver
 * (returning a sentinel secret, or a missing/expired/rotated status) and never
 * touch a real secret store. The default implementation reads from an approved
 * env-based store; a value's ABSENCE is reported as `missing`. Expired/rotated
 * are statuses a more capable store (or a provider auth-challenge mapping) can
 * report — the resolver contract carries all three so the pure credential policy
 * can map each to a sanitized pause category.
 *
 * Contract: pure of side effects beyond reading the injected store; it never
 * logs, never fetches, and never persists.
 */
import type { CredentialFailureStatus } from "./incremental/credential-policy";

export type { CredentialFailureStatus };

/**
 * Live authentication material for a single request, built IN MEMORY. Either an
 * Authorization header (name + value) or a temporary signed URL — never both,
 * and never persisted. On failure, only the sanitized `status` is returned.
 */
export type ResolvedCredential =
  | { ok: true; kind: "header"; headerName: "authorization"; headerValue: string }
  | { ok: true; kind: "signed-url"; signedUrl: string }
  | { ok: false; status: CredentialFailureStatus };

/**
 * The injectable resolver seam. Production installs {@link EnvCredentialResolver};
 * tests install a fake that returns scripted results (including a rotated secret
 * behind a fixed `credentialRef`).
 */
export interface CredentialResolver {
  /** Resolves a secret-free credential handle to in-memory auth material. */
  resolve(credentialRef: string): ResolvedCredential;
}

/**
 * Builds an Authorization header value IN MEMORY from a raw secret. Kept tiny and
 * pure so it is never tempting to inline (and never logged): callers pass the
 * result straight to the fetch layer and discard it.
 */
export function buildAuthorizationHeaderValue(secret: string): string {
  return `Bearer ${secret}`;
}

/**
 * Default env-based resolver over an APPROVED secret store. The `credentialRef`
 * is used as the lookup key (e.g. an env-var name); its VALUE (the secret) is
 * read and immediately wrapped into an in-memory Authorization header. A missing
 * or empty value is reported as `missing` — never as an error carrying the key
 * or any value. This resolver never emits `expired`/`rotated` itself (a bare env
 * store cannot detect those); those statuses arrive via the fake resolver in
 * tests or a richer store/provider-response mapping.
 */
export class EnvCredentialResolver implements CredentialResolver {
  private readonly env: Record<string, string | undefined>;

  constructor(env?: Record<string, string | undefined>) {
    this.env = env ?? process.env;
  }

  resolve(credentialRef: string): ResolvedCredential {
    const secret = this.env[credentialRef];
    if (typeof secret !== "string" || secret.length === 0) {
      return { ok: false, status: "missing" };
    }
    return {
      ok: true,
      kind: "header",
      headerName: "authorization",
      headerValue: buildAuthorizationHeaderValue(secret),
    };
  }
}
